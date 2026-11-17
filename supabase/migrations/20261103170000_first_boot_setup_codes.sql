-- Short-lived school-issued codes for the PrimeBook first-boot wizard.
-- Codes are stored only as SHA-256 digests and become bound to one device secret.
create table public.school_setup_codes (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references public.schools(id) on delete cascade,
  code_hash           text not null unique check(code_hash ~ '^[0-9a-f]{64}$'),
  created_by          uuid references auth.users(id) on delete set null default auth.uid(),
  expires_at          timestamptz not null default now() + interval '15 minutes',
  claimed_secret_hash text check(claimed_secret_hash is null or claimed_secret_hash ~ '^[0-9a-f]{64}$'),
  claimed_at          timestamptz,
  used_at             timestamptz,
  created_at          timestamptz not null default now()
);
create index school_setup_codes_active_idx on public.school_setup_codes(code_hash,expires_at) where used_at is null;
alter table public.school_setup_codes enable row level security;
revoke all on public.school_setup_codes from public,anon,authenticated;
grant all on public.school_setup_codes to service_role;

create table public.first_boot_sessions (
  id                  uuid primary key default gen_random_uuid(),
  request_secret_hash text not null check(request_secret_hash ~ '^[0-9a-f]{64}$'),
  setup_code_id       uuid not null references public.school_setup_codes(id) on delete cascade,
  school_id           uuid not null references public.schools(id) on delete cascade,
  device_id           uuid references public.devices(id) on delete set null,
  hardware_id         text not null check(length(hardware_id) between 3 and 200),
  serial              text,
  prime_id            text check(prime_id is null or prime_id ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'),
  android_id          text,
  model               text,
  student_name        text,
  status              text not null default 'verified' check(status in ('verified','assigned','activated','expired')),
  expires_at          timestamptz not null default now() + interval '30 minutes',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index first_boot_sessions_device_idx on public.first_boot_sessions(device_id,created_at desc);
create index first_boot_sessions_secret_idx on public.first_boot_sessions(request_secret_hash,created_at desc);
create trigger first_boot_sessions_touch before update on public.first_boot_sessions
  for each row execute function public.touch_updated_at();
alter table public.first_boot_sessions enable row level security;
revoke all on public.first_boot_sessions from public,anon,authenticated;
grant all on public.first_boot_sessions to service_role;

create function public.staff_issue_school_setup_code(p_school uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_code text; v_hash text; v_id uuid; tries integer:=0;
begin
  if auth.uid() is null or not public.can_manage_school(p_school) then
    raise exception 'School administrator access required' using errcode='42501';
  end if;
  loop
    tries:=tries+1;
    v_code:=lpad(((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint % 1000000))::text,6,'0');
    v_hash:=encode(extensions.digest(v_code,'sha256'),'hex');
    begin
      insert into public.school_setup_codes(school_id,code_hash) values(p_school,v_hash) returning id into v_id;
      exit;
    exception when unique_violation then
      if tries>=8 then raise exception 'Could not issue a unique setup code'; end if;
    end;
  end loop;
  return jsonb_build_object('id',v_id,'code',v_code,'expires_at',now()+interval '15 minutes');
end;
$$;

revoke all on function public.staff_issue_school_setup_code(uuid) from public,anon;
grant execute on function public.staff_issue_school_setup_code(uuid) to authenticated,service_role;
notify pgrst,'reload schema';
