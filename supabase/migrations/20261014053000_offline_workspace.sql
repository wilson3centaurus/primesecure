-- Durable idempotent student actions, private support conversations and recovery readiness.
alter table public.student_records add column username text not null default '' check(length(username)<=40),
 add column profile_photo text check(length(profile_photo)<=100000);
alter table public.hub_settings add column keep_wifi_on boolean not null default true;

create table public.school_classes (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
 form_level text not null check(length(btrim(form_level)) between 1 and 80), class_name text not null default '' check(length(class_name)<=80),
 unique(school_id,form_level,class_name)
);
alter table public.school_classes enable row level security;
revoke all on public.school_classes from anon,authenticated;
grant select,insert,update,delete on public.school_classes to authenticated;
create policy school_classes_read on public.school_classes for select to authenticated using(public.can_view_school(school_id));
create policy school_classes_manage on public.school_classes for all to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));
insert into public.school_classes(school_id,form_level) select s.id,'Form '||n from public.schools s cross join generate_series(1,6) n on conflict do nothing;
insert into public.school_classes(school_id,form_level,class_name) select distinct school_id,form_level,class_name from public.devices where form_level<>'' on conflict do nothing;

create table public.support_messages (
 id uuid primary key default gen_random_uuid(), device_id uuid not null references public.devices(id) on delete cascade,
 school_id uuid not null references public.schools(id) on delete cascade,
 sender text not null check(sender in ('student','support')), category text not null default 'support' check(category in ('support','name_correction')),
 body text not null check(length(btrim(body)) between 1 and 4000), staff_id uuid references public.profiles(id), created_at timestamptz not null default now()
);
create index support_messages_device_time on public.support_messages(device_id,created_at desc);
create index support_messages_school_time on public.support_messages(school_id,created_at desc);
alter table public.support_messages enable row level security;
revoke all on public.support_messages from anon,authenticated;
grant select on public.support_messages to authenticated;
create policy support_messages_read on public.support_messages for select to authenticated using(device_id=public.current_device_id() or public.can_manage_school(school_id));

create table public.device_action_receipts (
 device_id uuid not null references public.devices(id) on delete cascade, request_id uuid not null,
 result jsonb not null, created_at timestamptz not null default now(), primary key(device_id,request_id)
);
alter table public.device_action_receipts enable row level security;
revoke all on public.device_action_receipts from public,anon,authenticated;

create table public.device_runtime (
 device_id uuid primary key references public.devices(id) on delete cascade, readings jsonb not null, reported_at timestamptz not null default now()
);
alter table public.device_runtime enable row level security;
revoke all on public.device_runtime from anon,authenticated;
grant select on public.device_runtime to authenticated;
create policy device_runtime_read on public.device_runtime for select to authenticated using(device_id=public.current_device_id() or exists(select 1 from public.devices d where d.id=device_id and public.can_manage_school(d.school_id)));

alter function public.device_student_profile(jsonb) rename to device_student_profile_base;
revoke all on function public.device_student_profile_base(jsonb) from public,anon,authenticated,service_role;
create function public.device_student_profile(p_profile jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare did uuid; u text; photo text;
begin
 did:=public.current_device_id();
 if did is null or auth.uid() is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 if jsonb_typeof(p_profile)<>'object' or octet_length(p_profile::text)>120000 then raise exception 'invalid profile'; end if;
 u:=btrim(coalesce(p_profile->>'username',''));
 if u<>'' and u !~ '^[A-Za-z0-9_.-]{3,40}$' then raise exception 'Username must contain 3 to 40 letters, numbers, dots, underscores or hyphens'; end if;
 photo:=nullif(p_profile->>'profile_photo','');
 if photo is not null and (length(photo)>100000 or photo !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$') then raise exception 'Choose a smaller profile picture'; end if;
 perform public.device_student_profile_base(p_profile-'profile_photo'-'username');
 update public.student_records set username=case when p_profile?'username' then u else username end,
 profile_photo=case when p_profile?'profile_photo' then photo else profile_photo end where device_id=did;
 return jsonb_build_object('ok',true);
end $$;

create function public.device_offline_action(p_request_id uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; answer jsonb;
begin
 select * into d from public.devices where auth_user_id=auth.uid() and auth.uid() is not null and status<>'retired' for update;
 if d.id is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 if p_request_id is null or p_action is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>120000 then raise exception 'invalid request'; end if;
 select result into answer from public.device_action_receipts where device_id=d.id and request_id=p_request_id;
 if found then return answer; end if;
 if (select count(*) from public.device_action_receipts where device_id=d.id and created_at>now()-interval '1 day')>=200 then raise exception 'Daily action limit reached'; end if;
 case p_action
 when 'profile' then answer:=public.device_student_profile(p_payload);
 when 'reply' then answer:=public.device_message_reply((p_payload->>'command_id')::uuid,p_payload->>'body',coalesce((p_payload->>'anonymous')::boolean,false));
 when 'wallpaper' then answer:=public.device_hub_action('wallpaper',(p_payload->>'item_id')::uuid);
 when 'request_app' then answer:=public.device_hub_action('request_app',null,p_payload->>'name',p_payload->>'reason');
 when 'support','name_appeal' then
   if (select count(*) from public.support_messages where device_id=d.id and sender='student' and created_at>now()-interval '1 day')>=50 then raise exception 'Daily support message limit reached'; end if;
   insert into public.support_messages(device_id,school_id,sender,category,body) values(d.id,d.school_id,'student',case when p_action='name_appeal' then 'name_correction' else 'support' end,btrim(p_payload->>'body'));
   answer:=jsonb_build_object('ok',true);
 else raise exception 'Unsupported offline action';
 end case;
 insert into public.device_action_receipts(device_id,request_id,result) values(d.id,p_request_id,answer);
 return answer;
end $$;

create function public.staff_support_reply(p_device_id uuid,p_body text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; sid uuid;
begin
 select * into d from public.devices where id=p_device_id;
 select id into sid from public.profiles where id=auth.uid() and auth.uid() is not null;
 if sid is null or d.id is null or not public.can_manage_school(d.school_id) then raise exception 'Administrator access required' using errcode='42501'; end if;
 insert into public.support_messages(device_id,school_id,sender,body,staff_id) values(d.id,d.school_id,'support',btrim(p_body),sid);
 return jsonb_build_object('ok',true);
end $$;
create function public.device_runtime_report(p_readings jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare did uuid;
begin
 did:=public.current_device_id();
 if did is null or auth.uid() is null or not exists(select 1 from public.devices where id=did and status<>'retired') then raise exception 'not an enrolled device' using errcode='42501'; end if;
 if jsonb_typeof(p_readings)<>'object' or octet_length(p_readings::text)>20000 then raise exception 'invalid readings'; end if;
 insert into public.device_runtime(device_id,readings) values(did,p_readings) on conflict(device_id) do update set readings=excluded.readings,reported_at=now();
 return jsonb_build_object('ok',true);
end $$;

alter function public.device_hub() rename to device_hub_workspace;
revoke all on function public.device_hub_workspace() from public,anon,authenticated,service_role;
create function public.device_hub() returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; result jsonb; keep_wifi boolean;
begin
 select * into d from public.devices where auth_user_id=auth.uid() and auth.uid() is not null and status<>'retired';
 if d.id is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 result:=public.device_hub_workspace();
 select coalesce((select keep_wifi_on from public.hub_settings where school_id=d.school_id),(select keep_wifi_on from public.hub_settings where scope='global'),true) into keep_wifi;
 return result || jsonb_build_object('status',d.status,'management',coalesce(result->'management','{}'::jsonb)||jsonb_build_object('keep_wifi_on',keep_wifi),
 'support_messages',coalesce((select jsonb_agg(to_jsonb(m)-'staff_id' order by m.created_at) from (select * from public.support_messages where device_id=d.id order by created_at desc limit 100) m),'[]'::jsonb));
end $$;

alter table public.commands drop constraint commands_type_check;
alter table public.commands add constraint commands_type_check check(type in ('message','install_apk','remove_apk','push_file','delete_file','list_files','locate','suspend','unsuspend','lock','unlock','retire','reset_password'));
-- Discard a temporary recovery password as soon as the result is acknowledged.
create or replace function public.device_ack_command(p_command_id uuid,p_status text,p_result jsonb default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_status not in ('delivered','succeeded','failed') then raise exception 'invalid status' using errcode='22023'; end if;
 update public.commands c set status=p_status,result=coalesce(p_result,c.result),delivered_at=coalesce(c.delivered_at,now()),
 executed_at=case when p_status in ('succeeded','failed') then now() else c.executed_at end,
 payload=case when c.type='reset_password' and p_status in ('succeeded','failed') then c.payload-'password' else c.payload end
 where c.id=p_command_id and c.device_id=public.current_device_id() and c.status in ('pending','delivered');
 if not found then raise exception 'command not found or already finished' using errcode='P0002'; end if;
end $$;
revoke all on function public.device_student_profile(jsonb),public.device_offline_action(uuid,text,jsonb),public.staff_support_reply(uuid,text),public.device_runtime_report(jsonb),public.device_hub() from public,anon;
grant execute on function public.device_student_profile(jsonb),public.device_offline_action(uuid,text,jsonb),public.staff_support_reply(uuid,text),public.device_runtime_report(jsonb),public.device_hub() to authenticated,service_role;
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.support_messages,public.hub_items,public.hub_access,public.hub_settings;
 end if;
end $$;
notify pgrst,'reload schema';
