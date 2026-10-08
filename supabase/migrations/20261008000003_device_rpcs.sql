-- RPCs the agent calls with its own device JWT. Each one resolves the device
-- from auth.uid(), so a device can only ever act on itself.

-- Effective policy for a device: its own override if present, otherwise the
-- school default, otherwise nothing ({} = agent clears every restriction).
create function public.effective_policy(p_device_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object(
              'id', p.id,
              'scope', case when p.device_id is null then 'school' else 'device' end,
              'wallpaper_url', p.wallpaper_url,
              'lock_wallpaper', p.lock_wallpaper,
              'block_installs', p.block_installs,
              'hide_settings', p.hide_settings,
              'hidden_apps', to_jsonb(p.hidden_apps),
              'allowed_apps', to_jsonb(p.allowed_apps),
              'updated_at', p.updated_at)
       from public.policies p
       join public.devices d on d.id = p_device_id
      where p.device_id = d.id or (p.device_id is null and p.school_id = d.school_id)
      order by (p.device_id is null)  -- device override first
      limit 1),
    '{}'::jsonb)
$$;

-- Best-effort client IP from the proxy headers PostgREST exposes.
create function public.request_ip()
returns inet
language plpgsql stable set search_path = ''
as $$
declare
  h jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  raw text := trim(coalesce(split_part(h ->> 'x-forwarded-for', ',', 1), h ->> 'x-real-ip', ''));
begin
  return nullif(raw, '')::inet;
exception when others then
  return null;
end;
$$;

-- Periodic heartbeat. Records what the agent reports and hands back
-- everything it needs to converge: status + effective policy.
create function public.device_check_in(p_info jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  d public.devices;
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
    'student_name', d.student_name,
    'policy', public.effective_policy(d.id),
    'pending_commands', (select count(*) from public.commands c
                          where c.device_id = d.id and c.status in ('pending', 'delivered')),
    'server_time', now());
end;
$$;

-- Agent reports progress on a command: delivered -> succeeded | failed.
create function public.device_ack_command(p_command_id uuid, p_status text, p_result jsonb default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_status not in ('delivered', 'succeeded', 'failed') then
    raise exception 'invalid status %', p_status using errcode = '22023';
  end if;

  update public.commands c
     set status       = p_status,
         result       = coalesce(p_result, c.result),
         delivered_at = coalesce(c.delivered_at, now()),
         executed_at  = case when p_status in ('succeeded', 'failed') then now() else c.executed_at end
   where c.id = p_command_id
     and c.device_id = public.current_device_id()
     and c.status in ('pending', 'delivered');

  if not found then
    raise exception 'command not found or already finished' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function
  public.effective_policy(uuid), public.request_ip(),
  public.device_check_in(jsonb), public.device_ack_command(uuid, text, jsonb)
from public, anon;
grant execute on function
  public.device_check_in(jsonb), public.device_ack_command(uuid, text, jsonb)
to authenticated;
grant execute on function public.effective_policy(uuid) to service_role;

-- Dashboard listens for enroll check-ins / command results; agents listen
-- for new commands and policy edits. Realtime still applies RLS per subscriber.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.devices, public.commands, public.policies;
  end if;
end;
$$;
