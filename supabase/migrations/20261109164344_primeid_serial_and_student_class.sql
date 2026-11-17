-- RoboKorda Prime ID is now the stable device serial rather than the Wi-Fi MAC.
-- Keep the field name for API compatibility while widening its validation.
alter table public.devices drop constraint if exists devices_prime_id_check;
alter table public.devices add constraint devices_prime_id_check
  check (prime_id is null or length(prime_id) between 3 and 200);

alter table public.first_boot_sessions drop constraint if exists first_boot_sessions_prime_id_check;
alter table public.first_boot_sessions add constraint first_boot_sessions_prime_id_check
  check (prime_id is null or length(prime_id) between 3 and 200);

alter table public.device_setup_requests drop constraint if exists device_setup_requests_prime_id_check;
alter table public.device_setup_requests add constraint device_setup_requests_prime_id_check
  check (prime_id is null or length(prime_id) between 3 and 200);

alter table public.devices
  add column if not exists class_form smallint check (class_form between 1 and 6),
  add column if not exists class_section text check (class_section ~ '^[A-Z]{1,4}$');

alter table public.first_boot_sessions
  add column if not exists class_form smallint check (class_form between 1 and 6),
  add column if not exists class_section text check (class_section ~ '^[A-Z]{1,4}$');
