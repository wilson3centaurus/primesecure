-- Suspend / lock / retire are device *states* the agent converges on at every
-- check-in (and immediately via Realtime), so a device that was offline still
-- ends up right. Staff set devices.status; the lock screen shows status_message.

alter table public.devices
  add column status_message    text check (length(status_message) <= 500),
  add column status_changed_at timestamptz,
  add column status_changed_by uuid references auth.users (id) on delete set null;

grant update (status_message) on public.devices to authenticated;

create function public.track_status_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger devices_status_change before update of status on public.devices
  for each row execute function public.track_status_change();

-- Same as before, plus status_message for the lock screen.
create or replace function public.device_check_in(p_info jsonb default '{}')
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
    'status_message', d.status_message,
    'student_name', d.student_name,
    'policy', public.effective_policy(d.id),
    'pending_commands', (select count(*) from public.commands c
                          where c.device_id = d.id and c.status in ('pending', 'delivered')),
    'server_time', now());
end;
$$;
