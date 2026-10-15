alter table public.hub_settings
 add column block_bluetooth_transfer boolean not null default false,
 add column block_bluetooth boolean not null default false,
 add column block_add_users boolean not null default false,
 add column block_user_switch boolean not null default false,
 add column block_factory_reset boolean not null default false,
 add column blocked_packages text[] not null default '{}',
 add column location_interval_minutes integer not null default 30 check(location_interval_minutes between 5 and 1440),
 add column usage_reporting boolean not null default false;
alter table public.hub_items add column source_url text check(source_url is null or source_url ~ '^https://');
insert into storage.buckets(id,name,public) values('primesecure-app-sources','primesecure-app-sources',true) on conflict(id) do nothing;
alter table public.devices
 add column prime_id text check(prime_id is null or prime_id ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'),
 add column prime_id_source text,
 add column lost_mode boolean not null default false,
 add column lost_alarm boolean not null default false,
 add column lost_message text not null default '',
 add column lost_previous_status text,
 add column lost_recovery_hash text,
 add column lost_changed_at timestamptz,
 add column lost_attempt_at timestamptz;
create unique index devices_prime_id_unique on public.devices(prime_id) where prime_id is not null;

alter function public.hub_app_allowed(uuid,text) rename to hub_app_allowed_school_base;
revoke all on function public.hub_app_allowed_school_base(uuid,text) from public,anon,authenticated,service_role;
create function public.hub_app_allowed(p_device uuid,p_package text) returns boolean language sql stable security definer set search_path='' as $$
 select not(p_package=any(coalesce(s.blocked_packages,g.blocked_packages,'{}'::text[]))) and coalesce(public.hub_app_allowed_school_base(p_device,p_package),false)
 from public.devices d left join public.hub_settings s on s.school_id=d.school_id left join public.hub_settings g on g.scope='global' where d.id=p_device
$$;
revoke all on function public.hub_app_allowed(uuid,text) from public,anon,authenticated;

create table public.device_usage_daily (
 device_id uuid not null references public.devices(id) on delete cascade,
 day date not null, screen_ms bigint not null default 0,online_ms bigint not null default 0,uptime_ms bigint not null default 0,
 usage_access boolean not null default false,coverage text not null default '',reported_at timestamptz not null default now(),
 primary key(device_id,day)
);
create table public.device_app_usage_daily (
 device_id uuid not null references public.devices(id) on delete cascade,
 day date not null,package text not null,label text not null,foreground_ms bigint not null,
 reported_at timestamptz not null default now(),primary key(device_id,day,package)
);
create index device_usage_day on public.device_usage_daily(day,device_id);
create index device_app_usage_day on public.device_app_usage_daily(day,device_id);
create table public.device_cases (
 id uuid primary key default gen_random_uuid(),device_id uuid not null references public.devices(id) on delete cascade,
 school_id uuid not null references public.schools(id) on delete cascade,
 category text not null check(category in ('unapproved_app','manual','lost_device')),
 title text not null check(length(title) between 1 and 200),package text not null default '',day date not null default current_date,
 state text not null default 'open' check(state in ('open','observing','resolved')),
 staff_note text not null default '' check(length(staff_note)<=4000),evidence jsonb not null default '{}',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index device_cases_unapproved_key on public.device_cases(device_id,category,package,day) where category='unapproved_app';
create index device_cases_school on public.device_cases(school_id,updated_at desc);
create table public.device_control_audit (
 id bigint generated always as identity primary key,device_id uuid not null references public.devices(id) on delete cascade,
 staff_id uuid,action text not null,created_at timestamptz not null default now()
);
alter table public.device_usage_daily enable row level security;
alter table public.device_app_usage_daily enable row level security;
alter table public.device_cases enable row level security;
alter table public.device_control_audit enable row level security;
revoke all on public.device_usage_daily,public.device_app_usage_daily,public.device_cases,public.device_control_audit from public,anon,authenticated;
grant select on public.device_usage_daily,public.device_app_usage_daily,public.device_cases,public.device_control_audit to authenticated;
create policy device_usage_read on public.device_usage_daily for select to authenticated using(exists(select 1 from public.devices d where d.id=device_id and public.can_manage_school(d.school_id)));
create policy device_app_usage_read on public.device_app_usage_daily for select to authenticated using(exists(select 1 from public.devices d where d.id=device_id and public.can_manage_school(d.school_id)));
create policy device_cases_read on public.device_cases for select to authenticated using(public.can_manage_school(school_id));
create policy device_audit_read on public.device_control_audit for select to authenticated using(exists(select 1 from public.devices d where d.id=device_id and public.can_manage_school(d.school_id)));

create function public.device_report_usage(p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; enabled boolean; report_day date; a jsonb; n bigint;pkg text;label text;
begin
 select * into d from public.devices where id=public.current_device_id() and auth_user_id=auth.uid() and status not in ('pending','retired');
 if d.id is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
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
  pkg:=a->>'package';label:=left(coalesce(a->>'label',pkg),160);
  if pkg is null or pkg !~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$' or length(pkg)>200 or coalesce(a->>'foreground_ms','') !~ '^[0-9]{1,12}$' then raise exception 'invalid app usage'; end if;
  n:=(a->>'foreground_ms')::bigint;if n>86400000 then raise exception 'invalid app duration'; end if;
  insert into public.device_app_usage_daily(device_id,day,package,label,foreground_ms) values(d.id,report_day,pkg,label,n)
  on conflict(device_id,day,package) do update set foreground_ms=greatest(device_app_usage_daily.foreground_ms,excluded.foreground_ms),label=excluded.label,reported_at=now();
  if n>=30000 and pkg not in ('android','com.robokorda.primesecure','com.android.systemui') and not public.hub_app_allowed(d.id,pkg)
   and not exists(select 1 from jsonb_array_elements(coalesce(d.installed_apps,'[]')) i where i->>'package'=pkg and coalesce((i->>'system')::boolean,false)) then
   insert into public.device_cases(device_id,school_id,category,title,package,day,evidence)
   values(d.id,d.school_id,'unapproved_app','Unapproved app activity: '||left(label,140),pkg,report_day,jsonb_build_object('foreground_ms',n,'source','Android aggregate usage'))
   on conflict(device_id,category,package,day) where category='unapproved_app' do update set evidence=excluded.evidence||jsonb_build_object('foreground_ms',greatest((device_cases.evidence->>'foreground_ms')::bigint,(excluded.evidence->>'foreground_ms')::bigint)),updated_at=now();
  end if;
 end loop;
 -- Bounded rolling retention; staff exports are available before expiry.
 delete from public.device_app_usage_daily where device_id=d.id and day<current_date-90;
 delete from public.device_usage_daily where device_id=d.id and day<current_date-90;
 return jsonb_build_object('enabled',true,'ok',true);
end $$;

create function public.staff_set_lost(p_device uuid,p_lost boolean,p_alarm boolean default false,p_message text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; code text;
begin
 select * into d from public.devices where id=p_device and public.can_manage_school(school_id) and status not in ('pending','retired') for update;
 if d.id is null then raise exception 'school administrator access required' using errcode='42501'; end if;
 if p_lost then
  code:=upper(replace(gen_random_uuid()::text,'-',''));
  code:=substr(code,1,16);
  update public.devices set lost_mode=true,lost_alarm=p_alarm,lost_message=left(coalesce(p_message,''),1000),
   lost_previous_status=case when lost_mode then lost_previous_status else status::text end,status='locked',
   lost_recovery_hash=encode(sha256(convert_to(code,'UTF8')),'hex'),lost_changed_at=now() where id=d.id;
 else
  update public.devices set lost_mode=false,lost_alarm=false,lost_recovery_hash=null,lost_message='',
   status=case when lost_mode then coalesce(lost_previous_status,'active')::public.device_status else status end,lost_changed_at=now() where id=d.id;
 end if;
 perform public.queue_device_sync(null,d.id,'settings');
 insert into public.device_control_audit(device_id,staff_id,action) values(d.id,auth.uid(),case when p_lost then 'marked_lost' else 'marked_found' end);
 return jsonb_build_object('ok',true,'recovery_code',code);
end $$;
create function public.device_recover_lost(p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices;
begin
 select * into d from public.devices where id=public.current_device_id() and auth_user_id=auth.uid() and status not in ('pending','retired') for update;
 if d.id is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 if not d.lost_mode then return jsonb_build_object('ok',true); end if;
 if length(coalesce(p_code,''))<>16 or d.lost_recovery_hash is distinct from encode(sha256(convert_to(upper(p_code),'UTF8')),'hex') then raise exception 'invalid recovery code' using errcode='42501'; end if;
 update public.devices set lost_mode=false,lost_alarm=false,lost_recovery_hash=null,status=coalesce(lost_previous_status,'active')::public.device_status,lost_changed_at=now() where id=d.id;
 perform public.queue_device_sync(null,d.id,'settings');
 insert into public.device_control_audit(device_id,action) values(d.id,'student_entered_admin_recovery_code');
 return jsonb_build_object('ok',true);
end $$;
create function public.staff_update_case(p_case uuid,p_state text,p_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_state not in ('open','observing','resolved') or length(coalesce(p_note,''))>4000 then raise exception 'invalid case update'; end if;
 update public.device_cases set state=p_state,staff_note=coalesce(p_note,''),updated_at=now() where id=p_case and public.can_manage_school(school_id);
 if not found then raise exception 'school administrator access required' using errcode='42501'; end if;
 return jsonb_build_object('ok',true);
end $$;
create function public.staff_set_prime_id(p_device uuid,p_prime_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare mac text:=upper(btrim(p_prime_id));
begin
 if coalesce(mac,'') !~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$' or mac in ('00:00:00:00:00:00','02:00:00:00:00:00','FF:FF:FF:FF:FF:FF') then raise exception 'Enter the verified Prime ID from the device label'; end if;
 update public.devices set prime_id=mac,prime_id_source='admin_verified' where id=p_device and public.can_manage_school(school_id);
 if not found then raise exception 'school administrator access required' using errcode='42501'; end if;
 return jsonb_build_object('ok',true);
end $$;
create function public.staff_create_case(p_device uuid,p_title text,p_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; cid uuid;
begin
 select * into d from public.devices where id=p_device and public.can_manage_school(school_id);
 if d.id is null then raise exception 'school administrator access required' using errcode='42501'; end if;
 if length(btrim(coalesce(p_title,''))) not between 1 and 200 or length(coalesce(p_note,''))>4000 then raise exception 'invalid case'; end if;
 insert into public.device_cases(device_id,school_id,category,title,staff_note) values(d.id,d.school_id,'manual',btrim(p_title),coalesce(p_note,'')) returning id into cid;
 return jsonb_build_object('id',cid);
end $$;
create function public.staff_usage_report(p_school uuid,p_days integer default 7) returns jsonb language plpgsql security definer set search_path='' as $$
declare devices jsonb;apps jsonb;totals jsonb;
begin
 if not coalesce(public.can_manage_school(p_school),false) then raise exception 'school administrator access required' using errcode='42501'; end if;
 if p_days not in (7,30) then raise exception 'invalid report period'; end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.screen_ms desc,r.student_name),'[]') into devices from (
  select d.id,d.student_name,d.student_id,d.prime_id,d.form_level,d.class_name,coalesce(sum(u.screen_ms),0) screen_ms,
   coalesce(sum(u.online_ms),0) online_ms,coalesce(sum(u.uptime_ms),0) uptime_ms,count(u.day) reported_days,
   coalesce(bool_or(u.usage_access),false) usage_access,count(u.day) filter(where u.usage_access) usage_access_days,array_agg(distinct u.coverage) filter(where u.coverage is not null) coverage,max(u.reported_at) last_reported_at
  from public.devices d left join public.device_usage_daily u on u.device_id=d.id and u.day between current_date-(p_days-1) and current_date
  where d.school_id=p_school group by d.id
 ) r;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.foreground_ms desc),'[]') into apps from (
  select a.package,max(a.label) label,sum(a.foreground_ms) foreground_ms,count(distinct a.device_id) device_count
  from public.device_app_usage_daily a join public.devices d on d.id=a.device_id where d.school_id=p_school and a.day between current_date-(p_days-1) and current_date
  group by a.package order by sum(a.foreground_ms) desc limit 100
 ) r;
 select jsonb_build_object('screen_ms',coalesce(sum(u.screen_ms),0),'online_ms',coalesce(sum(u.online_ms),0),'uptime_ms',coalesce(sum(u.uptime_ms),0),'reporting_devices',count(distinct u.device_id),
  'app_package_count',(select count(distinct a.package) from public.device_app_usage_daily a join public.devices x on x.id=a.device_id where x.school_id=p_school and a.day between current_date-(p_days-1) and current_date)) into totals
 from public.device_usage_daily u join public.devices d on d.id=u.device_id where d.school_id=p_school and u.day between current_date-(p_days-1) and current_date;
 return jsonb_build_object('devices',devices,'apps',apps,'totals',totals,'days',p_days);
end $$;

alter function public.device_runtime_report(jsonb) rename to device_runtime_report_school_base;
revoke all on function public.device_runtime_report_school_base(jsonb) from public,anon,authenticated,service_role;
create function public.device_runtime_report(p_readings jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;mac text:=upper(p_readings->>'prime_id');
begin
 result:=public.device_runtime_report_school_base(p_readings);
 if mac ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$' and mac not in ('00:00:00:00:00:00','02:00:00:00:00:00','FF:FF:FF:FF:FF:FF') then
  update public.devices d set prime_id=mac,prime_id_source='device_hardware' where d.id=public.current_device_id() and d.prime_id is null and not exists(select 1 from public.devices x where x.prime_id=mac);
 end if;
 return result;
end $$;

create function public.enforce_lost_lock() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='retired' then new.lost_mode:=false;new.lost_alarm:=false;new.lost_recovery_hash:=null;
 elsif new.lost_mode then new.status:='locked'; end if;
 return new;
end $$;
create trigger lost_status_guard before update on public.devices for each row execute function public.enforce_lost_lock();
revoke all on function public.enforce_lost_lock() from public,anon,authenticated;

alter function public.device_check_in(jsonb) rename to device_check_in_school_base;
revoke all on function public.device_check_in_school_base(jsonb) from public,anon,authenticated,service_role;
create function public.device_check_in(p_info jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;d public.devices;
begin
 result:=public.device_check_in_school_base(p_info);
 select * into d from public.devices where id=public.current_device_id() and auth_user_id=auth.uid();
 return result||jsonb_build_object('lost_mode',d.lost_mode,'lost_alarm',d.lost_alarm,'lost_message',d.lost_message,'prime_id',d.prime_id);
end $$;
alter function public.device_hub() rename to device_hub_school_base;
revoke all on function public.device_hub_school_base() from public,anon,authenticated,service_role;
create function public.device_hub() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;d public.devices;s public.hub_settings;g public.hub_settings;
begin
 result:=public.device_hub_school_base();
 select * into d from public.devices where id=public.current_device_id() and auth_user_id=auth.uid();
 select * into s from public.hub_settings where school_id=d.school_id;
 select * into g from public.hub_settings where scope='global';
 return result||jsonb_build_object('prime_id',d.prime_id,'lost_mode',d.lost_mode,'management',coalesce(result->'management','{}')||jsonb_build_object(
  'block_bluetooth_transfer',coalesce(s.block_bluetooth_transfer,g.block_bluetooth_transfer,false),'block_bluetooth',coalesce(s.block_bluetooth,g.block_bluetooth,false),
  'block_add_users',coalesce(s.block_add_users,g.block_add_users,false),'block_user_switch',coalesce(s.block_user_switch,g.block_user_switch,false),
  'block_factory_reset',coalesce(s.block_factory_reset,g.block_factory_reset,false),'blocked_packages',coalesce(s.blocked_packages,g.blocked_packages,'{}'::text[]),
  'location_interval_minutes',coalesce(s.location_interval_minutes,g.location_interval_minutes,30),'usage_reporting',coalesce(s.usage_reporting,g.usage_reporting,false)));
end $$;

-- An explicit student capture is attached only after Android camera UI/confirmation.
alter table public.support_messages add column attachment_data text check(attachment_data is null or (length(attachment_data)<=100000 and attachment_data ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$'));
alter table public.support_messages add column capture_request_id uuid;
create unique index support_capture_request on public.support_messages(device_id,capture_request_id) where capture_request_id is not null;
create function public.device_support_photo(p_image text,p_caption text default '',p_request_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices;
begin
 select * into d from public.devices where id=public.current_device_id() and auth_user_id=auth.uid() and status not in ('pending','retired') for update;
 if d.id is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 if p_request_id is not null and exists(select 1 from public.support_messages where device_id=d.id and capture_request_id=p_request_id) then return jsonb_build_object('ok',true,'duplicate',true); end if;
 if (select count(*) from public.support_messages where device_id=d.id and sender='student' and created_at>now()-interval '1 day')>=50 then raise exception 'Daily support message limit reached'; end if;
 if length(coalesce(p_image,''))>100000 or coalesce(p_image,'') !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' or length(coalesce(p_caption,''))>4000 then raise exception 'invalid support photo'; end if;
 insert into public.support_messages(device_id,school_id,sender,body,attachment_data,capture_request_id) values(d.id,d.school_id,'student',coalesce(nullif(btrim(p_caption),''),'Photo shared by the student'),p_image,p_request_id);
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.device_report_usage(jsonb),public.staff_set_lost(uuid,boolean,boolean,text),public.device_recover_lost(text),public.staff_update_case(uuid,text,text),public.staff_set_prime_id(uuid,text),public.device_support_photo(text,text,uuid),public.device_check_in(jsonb),public.device_hub() from public,anon;
grant execute on function public.device_report_usage(jsonb),public.staff_set_lost(uuid,boolean,boolean,text),public.device_recover_lost(text),public.staff_update_case(uuid,text,text),public.staff_set_prime_id(uuid,text),public.device_support_photo(text,text,uuid),public.device_check_in(jsonb),public.device_hub() to authenticated,service_role;
revoke all on function public.staff_create_case(uuid,text,text) from public,anon;
grant execute on function public.staff_create_case(uuid,text,text) to authenticated,service_role;
revoke all on function public.staff_usage_report(uuid,integer),public.device_runtime_report(jsonb) from public,anon;
grant execute on function public.staff_usage_report(uuid,integer),public.device_runtime_report(jsonb) to authenticated,service_role;
notify pgrst,'reload schema';
