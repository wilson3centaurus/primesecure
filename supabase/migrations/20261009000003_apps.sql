-- App library and installed-app reporting.
--
-- Admins upload APKs to storage (apks/<school_id>/...) and list them in
-- public.apps; install_apk commands carry the storage path and the Device
-- Owner agent installs silently. Agents report what is installed on each
-- check-in (only when it changed), which the dashboard shows and uses for
-- remove_apk.

create table public.apps (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools (id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  storage_path text not null check (split_part(storage_path, '/', 1) = school_id::text),
  size         bigint,
  package_name text,
  version_name text,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index apps_school_idx on public.apps (school_id, name);

alter table public.apps enable row level security;
revoke all on public.apps from anon;

create policy apps_select on public.apps for select to authenticated
  using (public.can_view_school(school_id));
create policy apps_insert on public.apps for insert to authenticated
  with check (public.can_manage_school(school_id));
create policy apps_update on public.apps for update to authenticated
  using (public.can_manage_school(school_id)) with check (public.can_manage_school(school_id));
create policy apps_delete on public.apps for delete to authenticated
  using (public.can_manage_school(school_id));

-- [{ "package": "...", "label": "...", "version": "...", "system": false }, ...]
alter table public.devices
  add column installed_apps   jsonb,
  add column apps_reported_at timestamptz;

create or replace function public.device_check_in(p_info jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  d public.devices;
  v_apps jsonb := case when jsonb_typeof(p_info -> 'apps') = 'array' then p_info -> 'apps' end;
begin
  update public.devices
     set last_seen_at     = now(),
         last_ip          = coalesce(public.request_ip(), last_ip),
         model            = coalesce(nullif(p_info ->> 'model', ''), model),
         manufacturer     = coalesce(nullif(p_info ->> 'manufacturer', ''), manufacturer),
         serial           = coalesce(nullif(p_info ->> 'serial', ''), serial),
         android_id       = coalesce(nullif(p_info ->> 'android_id', ''), android_id),
         os_version       = coalesce(nullif(p_info ->> 'os_version', ''), os_version),
         agent_version    = coalesce(nullif(p_info ->> 'agent_version', ''), agent_version),
         battery_level    = coalesce((p_info ->> 'battery_level')::smallint, battery_level),
         battery_charging = coalesce((p_info ->> 'battery_charging')::boolean, battery_charging),
         installed_apps   = coalesce(v_apps, installed_apps),
         apps_reported_at = case when v_apps is not null then now() else apps_reported_at end,
         status           = case when status = 'pending' then 'active'::public.device_status else status end
   where auth_user_id = auth.uid() and auth.uid() is not null
  returning * into d;

  if d.id is null then
    raise exception 'not an enrolled device' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'device_id', d.id,
    'school_id', d.school_id,
    'status', d.status,
    'status_message', d.status_message,
    'student_name', d.student_name,
    'policy', public.effective_policy(d.id),
    'pending_commands', (select count(*) from public.commands c
                          where c.device_id = d.id and c.status in ('pending', 'delivered')),
    -- Lets the agent re-send its app list if the server lost it (e.g. re-enrolled row).
    'apps_known', d.installed_apps is not null,
    'server_time', now());
end;
$$;
