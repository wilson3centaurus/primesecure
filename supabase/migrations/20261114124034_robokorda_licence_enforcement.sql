-- RoboKorda licence state is deliberately separate from MDM device status.
-- Validation starts disabled so OS/MDM testing cannot be blocked by a
-- commercial control that has not yet been accepted for production.
create table public.robokorda_licence_configuration (
  singleton boolean primary key default true check (singleton),
  validation_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.robokorda_licence_configuration(singleton,validation_enabled)
values(true,false) on conflict(singleton) do nothing;
alter table public.robokorda_licence_configuration enable row level security;
revoke all on public.robokorda_licence_configuration from public,anon,authenticated;

alter table public.devices
  add column licence_state text not null default 'good' check (licence_state in ('good','expired')),
  add column licence_changed_at timestamptz,
  add column licence_changed_by uuid references auth.users(id) on delete set null;

-- Existing serials become the RoboKorda Prime ID where that serial is unique.
update public.devices d set prime_id=upper(btrim(d.serial)),prime_id_source='device_serial'
where nullif(btrim(d.serial),'') is not null
  and not exists(select 1 from public.devices x where x.id<>d.id and upper(btrim(x.serial))=upper(btrim(d.serial)))
  and (d.prime_id is null or d.prime_id is distinct from upper(btrim(d.serial)));

create function public.staff_licence_configuration() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.robokorda_licence_configuration;
begin
 if auth.uid() is null or not coalesce(public.is_super_admin(),false) then
  raise exception 'RoboKorda administrator access required' using errcode='42501';
 end if;
 select * into c from public.robokorda_licence_configuration where singleton=true;
 return jsonb_build_object('validation_enabled',c.validation_enabled,'updated_at',c.updated_at);
end $$;

create function public.staff_set_licence_validation(p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(public.is_super_admin(),false) then
  raise exception 'RoboKorda administrator access required' using errcode='42501';
 end if;
 update public.robokorda_licence_configuration set validation_enabled=coalesce(p_enabled,false),updated_at=now(),updated_by=auth.uid()
 where singleton=true;
 perform public.queue_device_sync(null,null,'licence');
 return jsonb_build_object('validation_enabled',coalesce(p_enabled,false));
end $$;

create function public.staff_set_device_licence(p_device uuid,p_state text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.devices;
begin
 if p_state not in ('good','expired') then raise exception 'Invalid licence state'; end if;
 select * into d from public.devices where id=p_device and coalesce(public.can_manage_school(school_id),false) for update;
 if d.id is null then raise exception 'School administrator access required' using errcode='42501'; end if;
 update public.devices set licence_state=p_state,licence_changed_at=now(),licence_changed_by=auth.uid() where id=d.id;
 perform public.queue_device_sync(null,d.id,'licence');
 insert into public.device_control_audit(device_id,staff_id,action)
 values(d.id,auth.uid(),'licence_'||p_state);
 return jsonb_build_object('device_id',d.id,'state',p_state);
end $$;

alter function public.device_check_in(jsonb) rename to device_check_in_licence_base;
revoke all on function public.device_check_in_licence_base(jsonb) from public,anon,authenticated,service_role;
create function public.device_check_in(p_info jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; d public.devices; enabled boolean; reported_serial text;
begin
 result:=public.device_check_in_licence_base(p_info);
 reported_serial:=upper(btrim(coalesce(p_info->>'serial','')));
 select * into d from public.devices where id=public.current_device_id() and auth_user_id=auth.uid() for update;
 if d.id is null then raise exception 'not an enrolled device' using errcode='42501'; end if;
 if reported_serial<>'' and length(reported_serial) between 3 and 200
   and not exists(select 1 from public.devices x where x.id<>d.id and x.prime_id=reported_serial) then
  update public.devices set serial=reported_serial,prime_id=reported_serial,prime_id_source='device_serial' where id=d.id;
  d.serial:=reported_serial; d.prime_id:=reported_serial; d.prime_id_source:='device_serial';
 end if;
 select validation_enabled into enabled from public.robokorda_licence_configuration where singleton=true;
 return result||jsonb_build_object('prime_id',coalesce(d.prime_id,d.serial),'robokorda_licence',jsonb_build_object(
  'validation_enabled',coalesce(enabled,false),
  'state',case when coalesce(enabled,false) then d.licence_state else 'good' end,
  'configured_state',d.licence_state,
  'prime_id',coalesce(d.prime_id,d.serial),
  'checked_at',now()
 ));
end $$;

revoke all on function public.staff_licence_configuration(),public.staff_set_licence_validation(boolean),public.staff_set_device_licence(uuid,text),public.device_check_in(jsonb) from public,anon,authenticated;
grant execute on function public.staff_licence_configuration(),public.staff_set_licence_validation(boolean),public.staff_set_device_licence(uuid,text),public.device_check_in(jsonb) to authenticated;
notify pgrst,'reload schema';
