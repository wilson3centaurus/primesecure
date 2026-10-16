-- Optional school controls. Existing schools keep their current behaviour.
alter table public.hub_settings
 add column lock_device_settings boolean not null default false,
 add column block_debugging_features boolean not null default false,
 add column lock_network_settings boolean not null default false;

alter function public.device_hub() rename to device_hub_settings_lockdown_base;
revoke all on function public.device_hub_settings_lockdown_base() from public,anon,authenticated,service_role;
create function public.device_hub() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; d public.devices; s public.hub_settings; g public.hub_settings;
begin
 result:=public.device_hub_settings_lockdown_base();
 select * into d from public.devices where id=public.current_device_id() and auth_user_id=auth.uid();
 if d.id is null then raise exception 'Device enrollment required';end if;
 select * into s from public.hub_settings where school_id=d.school_id;
 select * into g from public.hub_settings where scope='global';
 return result||jsonb_build_object('management',coalesce(result->'management','{}')||jsonb_build_object(
  'lock_device_settings',coalesce(s.lock_device_settings,g.lock_device_settings,false),
  'block_debugging_features',coalesce(s.block_debugging_features,g.block_debugging_features,false),
  'lock_network_settings',coalesce(s.lock_network_settings,g.lock_network_settings,false)));
end $$;
revoke all on function public.device_hub() from public,anon;
grant execute on function public.device_hub() to authenticated,service_role;
notify pgrst,'reload schema';
