-- PrimeSecure core schema: RoboKorda -> schools -> devices.
--
-- Two kinds of auth.users exist:
--   * people (super_admin / school_admin / teacher) — have a row in public.profiles
--   * devices — have NO profile; linked through public.devices.auth_user_id
-- Nobody gets a profile automatically, so a device (or any stray signup) has no
-- staff access by default.

create type public.app_role as enum ('super_admin', 'school_admin', 'teacher');

-- 'pending' = created in the dashboard, enroll token issued, agent not yet checked in.
create type public.device_status as enum ('pending', 'active', 'suspended', 'locked', 'retired');

create table public.schools (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  school_id  uuid references public.schools (id) on delete cascade,
  role       public.app_role not null default 'teacher',
  full_name  text,
  created_at timestamptz not null default now(),
  -- Only super_admins work across schools.
  constraint profiles_school_required check (role = 'super_admin' or school_id is not null)
);
create index profiles_school_id_idx on public.profiles (school_id);

-- Short, typeable enroll tokens (e.g. K7QF-M2XP) from Crockford base32.
-- Bytes 0-5 and 10-11 of a v4 UUID are fully random; 256 % 32 = 0 so no bias.
create function public.gen_enroll_token()
returns text
language sql
volatile
set search_path = ''
as $$
  with b as (select uuid_send(gen_random_uuid()) as bytes)
  select string_agg(
           substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', get_byte(b.bytes, i) % 32 + 1, 1)
             || case when ord = 4 then '-' else '' end,
           '' order by ord)
  from b,
       unnest(array[0, 1, 2, 3, 4, 5, 10, 11]) with ordinality as t(i, ord);
$$;

create table public.devices (
  id                       uuid primary key default gen_random_uuid(),
  school_id                uuid not null references public.schools (id) on delete cascade,
  enroll_token             text unique default public.gen_enroll_token(),
  enroll_token_expires_at  timestamptz default now() + interval '7 days',
  auth_user_id             uuid unique references auth.users (id) on delete set null,
  model                    text,
  manufacturer             text,
  serial                   text,
  android_id               text,
  os_version               text,
  agent_version            text,
  student_name             text,
  student_id               text,
  status                   public.device_status not null default 'pending',
  battery_level            smallint check (battery_level between 0 and 100),
  battery_charging         boolean,
  last_seen_at             timestamptz,
  last_ip                  inet,
  enrolled_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index devices_school_id_idx on public.devices (school_id);
create index devices_last_seen_idx on public.devices (school_id, last_seen_at desc);

-- One school-wide default policy (device_id null) plus optional per-device
-- overrides. A device override replaces the school default wholesale.
create table public.policies (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools (id) on delete cascade,
  device_id       uuid unique references public.devices (id) on delete cascade,
  wallpaper_url   text,
  lock_wallpaper  boolean not null default false,
  block_installs  boolean not null default false,
  hide_settings   boolean not null default false,
  hidden_apps     text[] not null default '{}',
  -- Non-empty = every launchable app not listed is hidden. Also the app set
  -- that stays usable while a device is suspended.
  allowed_apps    text[] not null default '{}',
  updated_at      timestamptz not null default now()
);
create unique index policies_one_default_per_school on public.policies (school_id) where device_id is null;

create table public.commands (
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid not null references public.devices (id) on delete cascade,
  school_id    uuid not null references public.schools (id) on delete cascade,
  type         text not null check (type in (
                 'message', 'install_apk', 'remove_apk', 'push_file', 'delete_file',
                 'locate', 'suspend', 'unsuspend', 'lock', 'unlock', 'retire')),
  payload      jsonb not null default '{}',
  status       text not null default 'pending'
                 check (status in ('pending', 'delivered', 'succeeded', 'failed', 'cancelled')),
  result       jsonb,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  delivered_at timestamptz,
  executed_at  timestamptz
);
create index commands_device_pending_idx on public.commands (device_id, created_at) where status in ('pending', 'delivered');
create index commands_school_created_idx on public.commands (school_id, created_at desc);

create table public.files (
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid not null references public.devices (id) on delete cascade,
  school_id    uuid not null references public.schools (id) on delete cascade,
  path         text not null,
  size         bigint,
  hash         text,
  action       text not null check (action in ('pushed', 'deleted', 'present')),
  storage_path text,
  created_at   timestamptz not null default now()
);
create index files_device_idx on public.files (device_id, created_at desc);

create table public.locations (
  id         bigint generated always as identity primary key,
  device_id  uuid not null references public.devices (id) on delete cascade,
  school_id  uuid not null references public.schools (id) on delete cascade,
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  accuracy   real,
  created_at timestamptz not null default now()
);
create index locations_device_idx on public.locations (device_id, created_at desc);

-- Child rows carry school_id for cheap RLS; always derive it from the device so
-- a caller can never file a row under another school.
create function public.set_school_from_device()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.device_id is not null then
    select d.school_id into strict new.school_id from public.devices d where d.id = new.device_id;
  end if;
  return new;
end;
$$;

create trigger commands_school before insert or update of device_id on public.commands
  for each row execute function public.set_school_from_device();
create trigger files_school before insert or update of device_id on public.files
  for each row execute function public.set_school_from_device();
create trigger locations_school before insert or update of device_id on public.locations
  for each row execute function public.set_school_from_device();
create trigger policies_school before insert or update of device_id on public.policies
  for each row execute function public.set_school_from_device();

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger devices_touch before update on public.devices
  for each row execute function public.touch_updated_at();
create trigger policies_touch before update on public.policies
  for each row execute function public.touch_updated_at();
