-- Agent self-update. A super_admin uploads a release-signed APK (built by the
-- agent-release workflow) to the private 'agent' bucket and records it here.
-- device_check_in hands each device the newest active release with a higher
-- version code than it reported; the agent verifies and installs it silently.

create table public.agent_releases (
  id           uuid primary key default gen_random_uuid(),
  version_code integer not null unique check (version_code > 0),
  version_name text not null,
  storage_path text not null,
  sha256       text check (sha256 ~ '^[0-9a-f]{64}$'),
  active       boolean not null default true,
  notes        text,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);

alter table public.agent_releases enable row level security;
revoke all on public.agent_releases from anon;

create policy agent_releases_select on public.agent_releases for select to authenticated
  using (public.auth_role() is not null);
create policy agent_releases_write on public.agent_releases for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

insert into storage.buckets (id, name, public)
values ('agent', 'agent', false)
on conflict (id) do nothing;

-- Any signed-in account (staff or device) may download agent builds; only super_admins publish.
create policy primesecure_agent_select on storage.objects for select to authenticated
  using (bucket_id = 'agent');
create policy primesecure_agent_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'agent' and public.is_super_admin());
create policy primesecure_agent_delete on storage.objects for delete to authenticated
  using (bucket_id = 'agent' and public.is_super_admin());

alter table public.devices add column agent_version_code integer;

create or replace function public.device_check_in(p_info jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  d public.devices;
  v_apps jsonb := case when jsonb_typeof(p_info -> 'apps') = 'array' then p_info -> 'apps' end;
  v_code integer := case when p_info ->> 'agent_version_code' ~ '^[0-9]{1,9}$'
                         then (p_info ->> 'agent_version_code')::integer end;
begin
  update public.devices
     set last_seen_at       = now(),
         last_ip            = coalesce(public.request_ip(), last_ip),
         model              = coalesce(nullif(p_info ->> 'model', ''), model),
         manufacturer       = coalesce(nullif(p_info ->> 'manufacturer', ''), manufacturer),
         serial             = coalesce(nullif(p_info ->> 'serial', ''), serial),
         android_id         = coalesce(nullif(p_info ->> 'android_id', ''), android_id),
         os_version         = coalesce(nullif(p_info ->> 'os_version', ''), os_version),
         agent_version      = coalesce(nullif(p_info ->> 'agent_version', ''), agent_version),
         agent_version_code = coalesce(v_code, agent_version_code),
         battery_level      = coalesce((p_info ->> 'battery_level')::smallint, battery_level),
         battery_charging   = coalesce((p_info ->> 'battery_charging')::boolean, battery_charging),
         installed_apps     = coalesce(v_apps, installed_apps),
         apps_reported_at   = case when v_apps is not null then now() else apps_reported_at end,
         status             = case when status = 'pending' then 'active'::public.device_status else status end
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
    'apps_known', d.installed_apps is not null,
    'agent_update', (select jsonb_build_object('version_code', r.version_code, 'version_name', r.version_name,
                                               'storage_path', r.storage_path, 'sha256', r.sha256)
                       from public.agent_releases r
                      where r.active and v_code is not null and r.version_code > v_code
                      order by r.version_code desc
                      limit 1),
    'server_time', now());
end;
$$;
