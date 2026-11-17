-- Administrator-approved first-run setup without a paid SMS dependency.
-- The device proves continuity with a high-entropy secret whose digest is stored.
create table public.device_setup_requests (
  id                  uuid primary key default gen_random_uuid(),
  request_secret_hash text not null unique check(request_secret_hash ~ '^[0-9a-f]{64}$'),
  verification_code   text not null check(verification_code ~ '^[0-9]{6}$'),
  school_id           uuid references public.schools(id) on delete cascade,
  device_id           uuid unique references public.devices(id) on delete set null,
  student_name        text not null check(length(btrim(student_name)) between 2 and 160),
  phone_e164          text not null check(phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  region              text not null check(length(btrim(region)) between 2 and 80),
  prime_id            text check(prime_id is null or prime_id ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'),
  model               text,
  serial              text,
  android_id          text,
  status              text not null default 'pending' check(status in ('pending','approved','enrolled','rejected','expired')),
  approved_by         uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  approved_at         timestamptz,
  enrolled_at         timestamptz
);
create index device_setup_school_status_idx on public.device_setup_requests(school_id,status,created_at desc);
create unique index device_setup_one_open_per_prime_id
  on public.device_setup_requests(prime_id) where prime_id is not null and status in ('pending','approved');
create trigger device_setup_requests_touch before update on public.device_setup_requests
  for each row execute function public.touch_updated_at();

alter table public.device_setup_requests enable row level security;
revoke all on public.device_setup_requests from public,anon;
grant select on public.device_setup_requests to authenticated,service_role;

create policy device_setup_request_select on public.device_setup_requests for select to authenticated
using (public.is_super_admin() or public.can_manage_school(school_id));

create function public.staff_approve_device_setup(p_request uuid,p_school uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.device_setup_requests; d public.devices;
begin
  if auth.uid() is null or not public.can_manage_school(p_school) then
    raise exception 'School administrator access required' using errcode='42501';
  end if;
  select * into r from public.device_setup_requests where id=p_request for update;
  if r.id is null then raise exception 'Setup request not found' using errcode='P0002'; end if;
  if r.status not in ('pending','approved') then raise exception 'Setup request is no longer pending'; end if;
  if r.school_id is not null and r.school_id<>p_school then raise exception 'Setup request belongs to another school' using errcode='42501'; end if;
  if r.device_id is null then
    insert into public.devices(school_id,student_name,model,serial,android_id,prime_id)
    values(p_school,r.student_name,r.model,r.serial,r.android_id,r.prime_id)
    returning * into d;
  else
    select * into d from public.devices where id=r.device_id and school_id=p_school;
    if d.id is null then raise exception 'Approved device record is unavailable'; end if;
  end if;
  update public.device_setup_requests set school_id=p_school,device_id=d.id,status='approved',
    approved_by=auth.uid(),approved_at=coalesce(approved_at,now()) where id=r.id;
  return jsonb_build_object('request_id',r.id,'device_id',d.id,'student_name',d.student_name,
    'enroll_token',d.enroll_token,'expires_at',d.enroll_token_expires_at,'status','approved');
end;
$$;

create function public.staff_reject_device_setup(p_request uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r public.device_setup_requests;
begin
  select * into r from public.device_setup_requests where id=p_request for update;
  if r.id is null then raise exception 'Setup request not found' using errcode='P0002'; end if;
  if auth.uid() is null or not (public.is_super_admin() or public.can_manage_school(r.school_id)) then
    raise exception 'School administrator access required' using errcode='42501';
  end if;
  if r.status not in ('pending','approved') then raise exception 'Setup request is no longer pending'; end if;
  update public.device_setup_requests set status='rejected',approved_by=auth.uid() where id=r.id;
end;
$$;

revoke all on function public.staff_approve_device_setup(uuid,uuid),public.staff_reject_device_setup(uuid) from public,anon;
grant execute on function public.staff_approve_device_setup(uuid,uuid),public.staff_reject_device_setup(uuid) to authenticated,service_role;
notify pgrst,'reload schema';
