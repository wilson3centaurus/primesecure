-- Student workspace, receipts and bounded cached inventory. Existing enrollment is preserved.
create sequence public.student_number_seq;
revoke all on sequence public.student_number_seq from anon,authenticated;
create function public.assign_student_number() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.student_id is null or btrim(new.student_id)='' then
  new.student_id := 'PS-' || extract(year from current_date)::text || '-' || lpad(nextval('public.student_number_seq')::text,6,'0');
 end if;
 return new;
end $$;
revoke all on function public.assign_student_number() from public,anon,authenticated;
create trigger student_number before insert on public.devices for each row execute function public.assign_student_number();
update public.devices set student_id='PS-' || extract(year from current_date)::text || '-' || lpad(nextval('public.student_number_seq')::text,6,'0') where student_id is null or btrim(student_id)='';
alter table public.devices add column form_level text not null default '', add column class_name text not null default '', add column gender text not null default '';
grant insert(form_level,class_name,gender),update(form_level,class_name,gender) on public.devices to authenticated;
alter table public.commands add column seen_at timestamptz;
alter table public.hub_items add column version_name text, add column icon_data text check(length(icon_data)<=300000), add column sha256 text;
alter table public.hub_settings add column block_usb_storage boolean not null default false, add column block_usb_transfer boolean not null default false,
 add column hide_file_managers boolean not null default false, add column viewer_packages jsonb not null default '{}',
 add column support_contacts jsonb not null default '[{"name":"Tafadzwa W. Sedze","phone":"0787209882"},{"name":"Rodney Mavura","phone":"0775009390"}]';
create table public.student_records (
 device_id uuid primary key references public.devices(id) on delete cascade,
 dob date not null, home_address text not null check(length(home_address) between 3 and 1000),
 mother_phone text not null default '' check(length(mother_phone)<=40), father_phone text not null default '' check(length(father_phone)<=40),
 personal_phone text not null default '' check(length(personal_phone)<=40), completed_at timestamptz not null default now(),
 check(mother_phone<>'' or father_phone<>'')
);
alter table public.student_records enable row level security;
revoke all on public.student_records from anon,authenticated;
grant select on public.student_records to authenticated;
create policy student_records_read on public.student_records for select to authenticated using(
 device_id=public.current_device_id() or exists(select 1 from public.devices d where d.id=device_id and public.can_manage_school(d.school_id)));
create table public.message_replies (
 id uuid primary key default gen_random_uuid(), command_id uuid not null references public.commands(id) on delete cascade,
 device_id uuid not null references public.devices(id) on delete cascade, school_id uuid not null references public.schools(id) on delete cascade,
 body text not null check(length(btrim(body)) between 1 and 4000), anonymous boolean not null default false, created_at timestamptz not null default now()
);
create index message_replies_school_time on public.message_replies(school_id,created_at desc);
create index message_replies_device_time on public.message_replies(device_id,created_at desc);
alter table public.message_replies enable row level security;
revoke all on public.message_replies from anon,authenticated;
grant select on public.message_replies to authenticated;
create policy message_replies_read on public.message_replies for select to authenticated using(public.can_view_school(school_id) or device_id=public.current_device_id());
create table public.device_file_cache (
 device_id uuid primary key references public.devices(id) on delete cascade, snapshot jsonb not null,
 scanned_at timestamptz not null default now(), uploaded_at timestamptz not null default now()
);
alter table public.device_file_cache enable row level security;
revoke all on public.device_file_cache from anon,authenticated;
grant select on public.device_file_cache to authenticated;
create policy device_file_cache_read on public.device_file_cache for select to authenticated using(
 exists(select 1 from public.devices d where d.id=device_id and public.can_manage_school(d.school_id)));

create function public.device_student_profile(p_profile jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; birth date;
begin
 select * into d from public.devices where auth_user_id=auth.uid() and auth.uid() is not null and status<>'retired';
 if d.id is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 if jsonb_typeof(p_profile)<>'object' or octet_length(p_profile::text)>4096 then raise exception 'invalid profile'; end if;
 birth := (p_profile->>'dob')::date;
 if birth is null or birth>current_date or birth<date '1900-01-01' then raise exception 'Enter a valid date of birth'; end if;
 insert into public.student_records(device_id,dob,home_address,mother_phone,father_phone,personal_phone)
 values(d.id,birth,btrim(coalesce(p_profile->>'home_address','')),btrim(coalesce(p_profile->>'mother_phone','')),btrim(coalesce(p_profile->>'father_phone','')),btrim(coalesce(p_profile->>'personal_phone','')))
 on conflict(device_id) do update set dob=excluded.dob,home_address=excluded.home_address,mother_phone=excluded.mother_phone,father_phone=excluded.father_phone,personal_phone=excluded.personal_phone,completed_at=now();
 return jsonb_build_object('ok',true);
end $$;
create function public.device_message_seen(p_command_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 update public.commands set seen_at=coalesce(seen_at,now()) where id=p_command_id and device_id=public.current_device_id() and auth.uid() is not null and type='message' and status<>'cancelled';
 if not found then raise exception 'message not found' using errcode='42501'; end if;
 return jsonb_build_object('ok',true);
end $$;
create function public.device_message_reply(p_command_id uuid,p_body text,p_anonymous boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; reply uuid;
begin
 select * into d from public.devices where auth_user_id=auth.uid() and auth.uid() is not null and status<>'retired' for update;
 if d.id is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 if not exists(select 1 from public.commands where id=p_command_id and device_id=d.id and type='message' and status<>'cancelled') then raise exception 'message not found' using errcode='42501'; end if;
 if (select count(*) from public.message_replies where device_id=d.id and created_at>now()-interval '1 day')>=50 then raise exception 'Daily reply limit reached'; end if;
 insert into public.message_replies(command_id,device_id,school_id,body,anonymous) values(p_command_id,d.id,d.school_id,btrim(p_body),coalesce(p_anonymous,false)) returning id into reply;
 return jsonb_build_object('ok',true,'id',reply);
end $$;
create or replace function public.device_message_history() returns jsonb language plpgsql security definer set search_path='' as $$
declare did uuid:=public.current_device_id();
begin
 if did is null or auth.uid() is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 return jsonb_build_object('messages',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from
 (select id,payload,created_at,acknowledged_at,seen_at from public.commands where device_id=did and type='message' and status<>'cancelled' order by created_at desc limit 1000) c),'[]'::jsonb),
 'replies',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.message_replies r where r.device_id=did),'[]'::jsonb));
end $$;
create function public.device_file_snapshot(p_snapshot jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare did uuid:=public.current_device_id();
begin
 if did is null or auth.uid() is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 if jsonb_typeof(p_snapshot)<>'object' or jsonb_typeof(p_snapshot->'entries') is distinct from 'array' or octet_length(p_snapshot::text)>2000000 or jsonb_array_length(p_snapshot->'entries')>5000 then raise exception 'Invalid or oversized snapshot'; end if;
 if exists(select 1 from jsonb_array_elements(p_snapshot->'entries') e where
 jsonb_typeof(e->'path') is distinct from 'string' or jsonb_typeof(e->'name') is distinct from 'string' or jsonb_typeof(e->'parent') is distinct from 'string'
 or length(e->>'path') not between 1 and 1000 or length(e->>'name') not between 1 and 255 or length(e->>'parent')>1000
 or e->>'path' like '/%' or e->>'path' ~ '(^|/)\.\.(/|$)' or e->>'parent' like '/%' or e->>'parent' ~ '(^|/)\.\.(/|$)'
 or jsonb_typeof(e->'dir') is distinct from 'boolean' or jsonb_typeof(e->'size') is distinct from 'number' or jsonb_typeof(e->'modified') is distinct from 'number'
 or coalesce(e->>'kind','') not in ('folder','image','video','audio','document')
 or length(coalesce(e->>'thumbnail',''))>40000 or (e ? 'thumbnail' and e->>'thumbnail' !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$')) then raise exception 'Invalid entry'; end if;
 insert into public.device_file_cache(device_id,snapshot) values(did,p_snapshot) on conflict(device_id) do update set snapshot=excluded.snapshot,scanned_at=now(),uploaded_at=now();
 return jsonb_build_object('ok',true);
end $$;

-- Keep the existing catalog authorization and install queue, then enrich the result.
create function public.device_file_snapshot_touch() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if public.current_device_id() is null or auth.uid() is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 update public.device_file_cache set scanned_at=now() where device_id=public.current_device_id();
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.device_file_snapshot_touch() from public,anon;
grant execute on function public.device_file_snapshot_touch() to authenticated,service_role;

alter function public.device_hub() rename to device_hub_catalog;
revoke all on function public.device_hub_catalog() from public,anon,authenticated,service_role;
create function public.device_hub() returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; cfg public.hub_settings; g public.hub_settings; result jsonb;
begin
 select * into d from public.devices where auth_user_id=auth.uid() and auth.uid() is not null and status<>'retired';
 if d.id is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 result:=public.device_hub_catalog();
 select * into cfg from public.hub_settings where school_id=d.school_id;
 select * into g from public.hub_settings where scope='global';
 return result || jsonb_build_object('school_name',(select name from public.schools where id=d.school_id),
 'student_id',d.student_id,'device_id',d.id,'form_level',d.form_level,'class_name',d.class_name,'gender',d.gender,
 'student_profile',coalesce((select to_jsonb(r)-'device_id' from public.student_records r where r.device_id=d.id),'null'::jsonb),
 'support_contacts',coalesce(cfg.support_contacts,g.support_contacts,'[{"name":"Tafadzwa W. Sedze","phone":"0787209882"},{"name":"Rodney Mavura","phone":"0775009390"}]'::jsonb),
 'management',jsonb_build_object('block_usb_storage',coalesce(cfg.block_usb_storage,g.block_usb_storage,false),'block_usb_transfer',coalesce(cfg.block_usb_transfer,g.block_usb_transfer,false),'hide_file_managers',coalesce(cfg.hide_file_managers,g.hide_file_managers,false),'viewer_packages',coalesce(cfg.viewer_packages,g.viewer_packages,'{}'::jsonb)));
end $$;
revoke all on function public.device_hub(),public.device_student_profile(jsonb),public.device_message_seen(uuid),public.device_message_reply(uuid,text,boolean),public.device_file_snapshot(jsonb) from public,anon;
grant execute on function public.device_hub(),public.device_student_profile(jsonb),public.device_message_seen(uuid),public.device_message_reply(uuid,text,boolean),public.device_file_snapshot(jsonb) to authenticated,service_role;
