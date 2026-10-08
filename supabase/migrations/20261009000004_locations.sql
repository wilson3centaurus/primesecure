-- Device location, reported on demand (the 'locate' command). Primebooks have
-- no GPS: the agent uses Android's network location where PrimeOS provides
-- one and falls back to an IP lookup, recording which in `source`.

alter table public.locations
  add column source text check (source in ('gps', 'network', 'fused', 'passive', 'ip'));

create function public.device_report_location(
  p_lat double precision,
  p_lng double precision,
  p_accuracy real default null,
  p_source text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_device uuid := public.current_device_id();
begin
  if v_device is null then
    raise exception 'not an enrolled device' using errcode = '42501';
  end if;
  insert into public.locations (device_id, lat, lng, accuracy, source)
  values (v_device, p_lat, p_lng, p_accuracy, p_source);
end;
$$;

revoke execute on function public.device_report_location(double precision, double precision, real, text) from public, anon;
grant execute on function public.device_report_location(double precision, double precision, real, text) to authenticated;
