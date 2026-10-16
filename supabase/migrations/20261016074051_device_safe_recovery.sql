-- Recovery controls are per device. Never grant device accounts direct writes.
create table public.device_safety_controls (
 device_id uuid primary key references public.devices(id) on delete cascade,
 revision bigint not null default 0,
 safe_mode boolean not null default false,
 ui_rollback_revision bigint not null default 0,
 updates_paused boolean not null default false,
 recovery_release_id uuid references public.agent_releases(id) on delete set null,
 updated_at timestamptz not null default now()
);
alter table public.device_safety_controls enable row level security;
revoke all on public.device_safety_controls from public,anon,authenticated;
grant select on public.device_safety_controls to authenticated;
create policy device_safety_read on public.device_safety_controls for select to authenticated
 using (exists(select 1 from public.devices d where d.id=device_id and coalesce(public.can_manage_school(d.school_id),false)));

create function public.staff_device_safety(p_device_id uuid,p_action text,p_release_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices; r public.agent_releases; c public.device_safety_controls;
begin
 select * into d from public.devices where id=p_device_id;
 if auth.uid() is null or d.id is null or not coalesce(public.can_manage_school(d.school_id),false) or d.status in ('pending','retired') then raise exception 'Administrator access to enrolled device required' using errcode='42501'; end if;
 if p_action is null or p_action not in ('safe_on','safe_off','rollback_ui','resume_updates','install_recovery') then raise exception 'Invalid recovery action'; end if;
 if p_action='install_recovery' then
  if not coalesce(public.is_super_admin(),false) then raise exception 'Only RoboKorda admins select recovery APKs' using errcode='42501'; end if;
  select * into r from public.agent_releases where id=p_release_id;
  if r.id is null or r.sha256 is null or d.agent_version_code is null or r.version_code<=d.agent_version_code then raise exception 'Recovery APK must have a checksum and a version code higher than the installed APK'; end if;
 end if;
 insert into public.device_safety_controls(device_id) values(d.id) on conflict do nothing;
 select * into c from public.device_safety_controls where device_id=d.id for update;
 update public.device_safety_controls set revision=revision+1,
  safe_mode=case when p_action='safe_on' then true when p_action='safe_off' then false else safe_mode end,
  ui_rollback_revision=case when p_action='rollback_ui' then revision+1 else ui_rollback_revision end,
  updates_paused=case when p_action in ('safe_on','rollback_ui','install_recovery') then true when p_action='resume_updates' then false else updates_paused end,
  recovery_release_id=case when p_action='install_recovery' then r.id when p_action in ('safe_on','rollback_ui','resume_updates') then null else recovery_release_id end,
  updated_at=now() where device_id=d.id returning * into c;
 perform public.queue_device_sync(d.school_id,d.id,'recovery');
 return to_jsonb(c);
end $$;

-- Private helper. Callers must first authorize a device JWT or recovery capability.
create function public.device_safety_payload(p_device_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('revision',c.revision,'safe_mode',c.safe_mode,'ui_rollback_revision',c.ui_rollback_revision,'updates_paused',c.updates_paused,
 'recovery_release',case when r.id is not null then jsonb_build_object('version_code',r.version_code,'version_name',r.version_name,'storage_path',r.storage_path,'sha256',r.sha256) else null end)
 from public.device_safety_controls c left join public.agent_releases r on r.id=c.recovery_release_id where c.device_id=p_device_id),
 '{"revision":0,"safe_mode":false,"ui_rollback_revision":0,"updates_paused":false}'::jsonb)
$$;
alter function public.device_check_in(jsonb) rename to device_check_in_safety_base;
revoke all on function public.device_check_in_safety_base(jsonb) from public,anon,authenticated,service_role;
create function public.device_check_in(p_info jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; controls jsonb;
begin
 result:=public.device_check_in_safety_base(p_info);
 controls:=public.device_safety_payload(public.current_device_id());
 result:=result||jsonb_build_object('recovery_control',controls);
 if (controls->>'updates_paused')::boolean then
  result:=jsonb_set(result,'{agent_update}',coalesce(controls->'recovery_release','null'::jsonb));
 end if;
 return result;
end $$;
alter function public.device_recovery_poll(uuid,text) rename to device_recovery_poll_safety_base;
revoke all on function public.device_recovery_poll_safety_base(uuid,text) from public,anon,authenticated,service_role;
create function public.device_recovery_poll(p_device_id uuid,p_secret text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 -- The original function verifies the capability, active device and rate limit.
 result:=public.device_recovery_poll_safety_base(p_device_id,p_secret);
 return result||jsonb_build_object('recovery_control',public.device_safety_payload(p_device_id));
end $$;
revoke all on function public.device_safety_payload(uuid),public.staff_device_safety(uuid,text,uuid),public.device_check_in(jsonb),public.device_recovery_poll(uuid,text) from public,anon,authenticated;
grant execute on function public.staff_device_safety(uuid,text,uuid),public.device_check_in(jsonb) to authenticated;
grant execute on function public.device_recovery_poll(uuid,text) to anon,authenticated;
notify pgrst,'reload schema';
