-- Visible, time-bounded remote controls. Never grants camera/screen consent on a student's behalf.
create schema remote_control_internal;
revoke all on schema remote_control_internal from public, anon, authenticated;

-- Extend rather than replace the existing command set (other releases may add commands).
do $$ declare previous text; begin
 select pg_get_expr(conbin,conrelid) into previous from pg_constraint
 where conrelid='public.commands'::regclass and conname='commands_type_check';
 alter table public.commands drop constraint commands_type_check;
 execute 'alter table public.commands add constraint commands_type_check check ((' ||
   previous || ') or type in (''alarm'',''request_capture''))';
end $$;

create table public.remote_capture_sessions (
 command_id uuid primary key references public.commands(id) on delete cascade,
 device_id uuid not null references public.devices(id) on delete cascade,
 school_id uuid not null references public.schools(id) on delete cascade,
 case_id uuid references public.device_cases(id) on delete set null,
 kind text not null check(kind in ('photo','screenshot')),
 state text not null default 'offered' check(state in ('offered','consented','completed','declined','failed')),
 expires_at timestamptz not null,
 consented_at timestamptz, completed_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.remote_capture_frames (
 command_id uuid primary key references public.remote_capture_sessions(command_id) on delete cascade,
 device_id uuid not null references public.devices(id) on delete cascade,
 school_id uuid not null references public.schools(id) on delete cascade,
 image text not null check(length(image)<=350000 and image ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$'),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days'
);
create index remote_capture_frames_expiry on public.remote_capture_frames(expires_at);
alter table public.remote_capture_sessions enable row level security;
alter table public.remote_capture_frames enable row level security;
revoke all on public.remote_capture_sessions,public.remote_capture_frames from public,anon,authenticated;
grant select on public.remote_capture_sessions,public.remote_capture_frames to authenticated;
create policy remote_capture_sessions_read on public.remote_capture_sessions for select to authenticated
 using (coalesce(public.can_manage_school(school_id),false));
create policy remote_capture_frames_read on public.remote_capture_frames for select to authenticated
 using (expires_at>now() and coalesce(public.can_manage_school(school_id),false));

create function remote_control_internal.guard_command() returns trigger language plpgsql security definer set search_path='' as $$
declare d public.devices; reason text; kind text; seconds integer; linked_case uuid;
begin
 if tg_op='UPDATE' then
  if old.type in ('alarm','request_capture') then
   if (new.type,new.device_id,new.school_id,new.created_at,new.payload) is distinct from
      (old.type,old.device_id,old.school_id,old.created_at,old.payload)
      or (new.created_by is distinct from old.created_by and not
       (new.created_by is null and not exists(select 1 from auth.users where id=old.created_by)))
      or (old.status in ('succeeded','failed','cancelled') and new.status<>old.status) then
    raise exception 'Remote controls cannot be edited or replayed; send a new authorized request';
   end if;
  elsif new.type in ('alarm','request_capture') then
   raise exception 'Create a new authorized remote control request';
  end if;
  return new;
 end if;
 if new.type not in ('alarm','request_capture') then return new; end if;
 select * into d from public.devices where id=new.device_id and school_id=new.school_id and status not in ('pending','retired') for update;
 if auth.uid() is null or d.id is null or not coalesce(public.can_manage_school(d.school_id),false) then
  raise exception 'School administrator access required' using errcode='42501';
 end if;
 if new.status<>'pending' or new.created_by is distinct from auth.uid() or new.payload->>'authorized' is distinct from 'true' then
  raise exception 'Confirm documented school authorization';
 end if;
 reason:=btrim(coalesce(new.payload->>'reason',''));
 if length(reason)<5 or length(reason)>500 then raise exception 'Enter a reason of 5 to 500 characters'; end if;
 if exists(select 1 from public.commands where device_id=d.id and type in ('alarm','request_capture') and created_at>now()-interval '1 minute') then
  raise exception 'Wait one minute between remote control requests';
 end if;
 new.created_at:=now();
 if new.type='alarm' then
  seconds:=coalesce((new.payload->>'duration_seconds')::integer,15);
  if seconds not between 5 and 30 then raise exception 'Alarm duration must be 5 to 30 seconds'; end if;
  new.payload:=jsonb_build_object('reason',reason,'authorized',true,'visible',true,'duration_seconds',seconds,'expires_at',now()+interval '2 minutes');
 else
  kind:=new.payload->>'kind';
  if kind is null or kind not in ('photo','screenshot') then raise exception 'Choose photo or screenshot'; end if;
  linked_case:=nullif(new.payload->>'case_id','')::uuid;
  if linked_case is not null and not exists(select 1 from public.device_cases where id=linked_case and device_id=d.id and school_id=d.school_id) then
   raise exception 'Choose a case for this device';
  end if;
  new.payload:=jsonb_build_object('reason',reason,'authorized',true,'visible',true,'kind',kind,'case_id',linked_case,'max_frames',1,'expires_at',now()+interval '10 minutes');
 end if;
 insert into public.device_control_audit(device_id,staff_id,action) values(d.id,auth.uid(),'requested_'||new.type||': '||reason);
 return new;
end $$;
revoke all on function remote_control_internal.guard_command() from public,anon,authenticated;
create trigger remote_control_guard before insert or update on public.commands for each row execute function remote_control_internal.guard_command();

create function remote_control_internal.create_capture_session() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.type='request_capture' then
  insert into public.remote_capture_sessions(command_id,device_id,school_id,kind,case_id,expires_at)
   values(new.id,new.device_id,new.school_id,new.payload->>'kind',(new.payload->>'case_id')::uuid,(new.payload->>'expires_at')::timestamptz);
 end if;
 return new;
end $$;
revoke all on function remote_control_internal.create_capture_session() from public,anon,authenticated;
create trigger remote_control_capture_session after insert on public.commands for each row execute function remote_control_internal.create_capture_session();

create function public.staff_request_remote_control(p_device uuid,p_type text,p_reason text,p_authorized boolean,p_seconds integer default 15,p_kind text default null,p_case uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.devices; cid uuid;
begin
 if auth.uid() is null or p_type is null or p_type not in ('alarm','request_capture') or p_authorized is distinct from true then raise exception 'Confirm documented school authorization' using errcode='42501'; end if;
 select * into d from public.devices where id=p_device and coalesce(public.can_manage_school(school_id),false);
 if d.id is null then raise exception 'School administrator access required' using errcode='42501'; end if;
 insert into public.commands(device_id,school_id,type,created_by,payload)
 values(d.id,d.school_id,p_type,auth.uid(),jsonb_build_object('reason',p_reason,'authorized',true,'duration_seconds',p_seconds,'kind',p_kind,'case_id',p_case)) returning id into cid;
 return jsonb_build_object('id',cid,'queued',true);
end $$;
revoke all on function public.staff_request_remote_control(uuid,text,text,boolean,integer,text,uuid) from public,anon;
grant execute on function public.staff_request_remote_control(uuid,text,text,boolean,integer,text,uuid) to authenticated;

-- Independent urgent lane: a long-running APK/file transfer must not hold an alarm behind it.
create function public.device_fetch_remote_controls() returns jsonb language plpgsql security definer set search_path='' as $$
declare did uuid; result jsonb;
begin
 select id into did from public.devices where id=public.current_device_id() and auth_user_id=auth.uid()
  and auth.uid() is not null and status not in ('pending','retired');
 if did is null then raise exception 'Not an enrolled device' using errcode='42501'; end if;
 update public.commands set status='failed',executed_at=now(),result=jsonb_build_object('error','Remote request expired before execution')
  where device_id=did and type in ('alarm','request_capture') and status in ('pending','delivered') and (payload->>'expires_at')::timestamptz<=now();
 with picked as (
  update public.commands c set status='delivered',delivered_at=coalesce(c.delivered_at,now())
  where c.id in (select q.id from public.commands q where q.device_id=did and q.type in ('alarm','request_capture')
   and q.status in ('pending','delivered') order by case when q.type='alarm' then 0 else 1 end,q.created_at limit 10 for update skip locked)
  returning c.id,c.type,c.payload,c.created_at
 ) select coalesce(jsonb_agg(to_jsonb(p) order by case when p.type='alarm' then 0 else 1 end,p.created_at),'[]'::jsonb) into result from picked p;
 return jsonb_build_object('commands',result);
end $$;
revoke all on function public.device_fetch_remote_controls() from public,anon;
grant execute on function public.device_fetch_remote_controls() to authenticated;

-- Image bytes stay in a private, RLS-protected table, never in command JSON or public storage.
create function remote_control_internal.capture_result(p_command uuid,p_state text,p_image text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.remote_capture_sessions; bytes bytea;
begin
 if auth.uid() is null then raise exception 'Not an enrolled device' using errcode='42501'; end if;
 select s0.* into s from public.remote_capture_sessions s0 join public.devices d on d.id=s0.device_id
  join public.commands c on c.id=s0.command_id
  where s0.command_id=p_command and d.id=public.current_device_id() and d.auth_user_id=auth.uid()
   and d.school_id=s0.school_id and c.type='request_capture' and c.device_id=s0.device_id
   and d.status not in ('pending','retired') and c.status in ('pending','delivered','succeeded') for update of s0;
 if s.command_id is null then raise exception 'Capture request not available for this device' using errcode='42501'; end if;
 if s.state='completed' and p_state='completed' then return jsonb_build_object('ok',true,'already_sent',true); end if;
 if s.expires_at<=now() or s.state not in ('offered','consented') then raise exception 'Capture request expired or already finished'; end if;
 if s.state='consented' and p_state='consented' and p_image is null then return jsonb_build_object('ok',true,'already_consented',true); end if;
 if p_state='consented' and s.state='offered' and p_image is null then
  update public.remote_capture_sessions set state='consented',consented_at=now(),expires_at=least(expires_at,now()+interval '2 minutes') where command_id=p_command;
 elsif p_state in ('declined','failed') and p_image is null then
  update public.remote_capture_sessions set state=p_state,completed_at=now() where command_id=p_command;
 elsif p_state='completed' and s.state='consented' and p_image is not null then
  if length(p_image)>350000 or p_image !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' then raise exception 'Invalid JPEG image'; end if;
  bytes:=decode(substr(p_image,24),'base64');
  if octet_length(bytes)>260000 or octet_length(bytes)<4 or substr(bytes,1,3)<>decode('ffd8ff','hex') then raise exception 'Invalid JPEG image'; end if;
  insert into public.remote_capture_frames(command_id,device_id,school_id,image) values(s.command_id,s.device_id,s.school_id,p_image);
  update public.remote_capture_sessions set state='completed',completed_at=now() where command_id=p_command;
 else raise exception 'Explicit on-device consent required before capture';
 end if;
 insert into public.device_control_audit(device_id,action) values(s.device_id,'capture_'||p_state||': '||p_command::text);
 return jsonb_build_object('ok',true);
end $$;
revoke all on function remote_control_internal.capture_result(uuid,text,text) from public,anon,authenticated;
-- Only this thin public wrapper is an API endpoint; all authorization is in the private primitive.
create function public.device_remote_capture(p_command uuid,p_state text,p_image text default null) returns jsonb language sql security definer set search_path='' as $$
 select remote_control_internal.capture_result(p_command,p_state,p_image)
$$;
revoke all on function public.device_remote_capture(uuid,text,text) from public,anon;
grant execute on function public.device_remote_capture(uuid,text,text) to authenticated;

create function remote_control_internal.purge_expired_frames() returns void language sql security definer set search_path='' as $$
 delete from public.remote_capture_frames where expires_at<=now()
$$;
revoke all on function remote_control_internal.purge_expired_frames() from public,anon,authenticated;
-- On installations without pg_cron, schedule this function using an owner-only maintenance job.
-- RLS denies expired images immediately even if the maintenance scheduler is unavailable.
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  execute $job$select cron.schedule('primesecure-capture-retention','*/15 * * * *','select remote_control_internal.purge_expired_frames()')$job$;
 end if;
end $$;

-- Exact, known OS components only. This is case classification, NOT an app permission allowlist.
create function remote_control_internal.expected_system_component(p_package text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(p_package in ('com.android.launcher3','com.android.documentsui','com.floydwiz.primesetup','com.floydwiz.primeos.appcompat'),false)
$$;
revoke all on function remote_control_internal.expected_system_component(text) from public,anon,authenticated;

create or replace function public.device_report_usage(p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; enabled boolean; report_day date; a jsonb; n bigint; pkg text; label text;
begin
 select * into d from public.devices where id=public.current_device_id() and auth_user_id=auth.uid() and status not in ('pending','retired');
 if d.id is null or auth.uid() is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 select coalesce((select usage_reporting from public.hub_settings where school_id=d.school_id),(select usage_reporting from public.hub_settings where scope='global'),false) into enabled;
 if not enabled then return jsonb_build_object('enabled',false); end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>100000 or jsonb_typeof(p_payload->'apps') is distinct from 'array' or jsonb_array_length(p_payload->'apps')>200 then raise exception 'invalid usage report'; end if;
 report_day:=(p_payload->>'day')::date;
 if report_day is null or report_day<current_date-30 or report_day>current_date+1 then raise exception 'invalid usage day'; end if;
 foreach pkg in array array['screen_ms','online_ms','uptime_ms'] loop
  if coalesce(p_payload->>pkg,'') !~ '^[0-9]{1,12}$' or (p_payload->>pkg)::bigint>86400000 then raise exception 'invalid usage duration'; end if;
 end loop;
 insert into public.device_usage_daily(device_id,day,screen_ms,online_ms,uptime_ms,usage_access,coverage)
 values(d.id,report_day,(p_payload->>'screen_ms')::bigint,(p_payload->>'online_ms')::bigint,(p_payload->>'uptime_ms')::bigint,coalesce((p_payload->>'usage_access')::boolean,false),left(coalesce(p_payload->>'coverage',''),500))
 on conflict(device_id,day) do update set screen_ms=greatest(device_usage_daily.screen_ms,excluded.screen_ms),online_ms=greatest(device_usage_daily.online_ms,excluded.online_ms),uptime_ms=greatest(device_usage_daily.uptime_ms,excluded.uptime_ms),usage_access=excluded.usage_access,coverage=excluded.coverage,reported_at=now();
 for a in select value from jsonb_array_elements(p_payload->'apps') loop
  pkg:=a->>'package'; label:=left(coalesce(a->>'label',pkg),160);
  if pkg is null or pkg !~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$' or length(pkg)>200 or coalesce(a->>'foreground_ms','') !~ '^[0-9]{1,12}$' then raise exception 'invalid app usage'; end if;
  n:=(a->>'foreground_ms')::bigint; if n>86400000 then raise exception 'invalid app duration'; end if;
  insert into public.device_app_usage_daily(device_id,day,package,label,foreground_ms) values(d.id,report_day,pkg,label,n)
  on conflict(device_id,day,package) do update set foreground_ms=greatest(device_app_usage_daily.foreground_ms,excluded.foreground_ms),label=excluded.label,reported_at=now();
  if n>=30000 and pkg not in ('android','com.robokorda.primesecure','com.android.systemui')
   and not remote_control_internal.expected_system_component(pkg)
   and not coalesce(public.hub_app_allowed(d.id,pkg),false)
   and not exists(select 1 from jsonb_array_elements(coalesce(d.installed_apps,'[]')) i where i->>'package'=pkg and i->>'system'='true') then
   insert into public.device_cases(device_id,school_id,category,title,package,day,evidence)
   values(d.id,d.school_id,'unapproved_app','Unapproved app activity: '||left(label,140),pkg,report_day,jsonb_build_object('foreground_ms',n,'source','Android aggregate usage'))
   on conflict(device_id,category,package,day) where category='unapproved_app' do update set evidence=excluded.evidence||jsonb_build_object('foreground_ms',greatest((device_cases.evidence->>'foreground_ms')::bigint,(excluded.evidence->>'foreground_ms')::bigint)),updated_at=now();
  end if;
 end loop;
 delete from public.device_app_usage_daily where device_id=d.id and day<current_date-90;
 delete from public.device_usage_daily where device_id=d.id and day<current_date-90;
 return jsonb_build_object('enabled',true,'ok',true);
end $$;

-- Preserve historical usage and staff-reviewed cases; close only untouched automatic false positives.
update public.device_cases set state='resolved',updated_at=now(),
 evidence=evidence||jsonb_build_object('classification','expected_system_component','auto_resolution','Known Android/PrimeOS launcher, file picker, setup or compatibility component; not misconduct.')
 where category='unapproved_app' and state='open' and btrim(staff_note)=''
 and remote_control_internal.expected_system_component(package);
