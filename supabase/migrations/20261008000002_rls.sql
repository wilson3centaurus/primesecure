-- Row level security: isolation keyed on school_id.
--
--   super_admin  : everything, every school
--   school_admin : everything inside their school (cannot create super_admins)
--   teacher      : read their school; send 'message' commands only
--   device       : read its own device row, policy and commands; writes go
--                  through the security-definer RPCs in the next migration

-- ---------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER so policies can read profiles without recursing
-- into profiles' own RLS.
-- ---------------------------------------------------------------------------

create function public.auth_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$ select p.role from public.profiles p where p.id = auth.uid() $$;

create function public.auth_school_id()
returns uuid
language sql stable security definer set search_path = ''
as $$ select p.school_id from public.profiles p where p.id = auth.uid() $$;

create function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.auth_role() = 'super_admin', false) $$;

-- Any staff member of the school (or a super_admin).
create function public.can_view_school(sid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_super_admin()
      or (sid is not null and sid = public.auth_school_id() and public.auth_role() is not null)
$$;

create function public.can_manage_school(sid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_super_admin()
      or (sid is not null and sid = public.auth_school_id() and public.auth_role() = 'school_admin')
$$;

-- The device row belonging to the calling device account, if any.
create function public.current_device_id()
returns uuid
language sql stable security definer set search_path = ''
as $$ select d.id from public.devices d where d.auth_user_id = auth.uid() and auth.uid() is not null $$;

revoke execute on function
  public.auth_role(), public.auth_school_id(), public.is_super_admin(),
  public.can_view_school(uuid), public.can_manage_school(uuid), public.current_device_id(),
  public.gen_enroll_token(), public.set_school_from_device(), public.touch_updated_at()
from public, anon;
grant execute on function
  public.auth_role(), public.auth_school_id(), public.is_super_admin(),
  public.can_view_school(uuid), public.can_manage_school(uuid), public.current_device_id(),
  public.gen_enroll_token()
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Grants: anon gets nothing; authenticated is narrowed by RLS below.
-- ---------------------------------------------------------------------------

revoke all on public.schools, public.profiles, public.devices, public.policies,
              public.commands, public.files, public.locations from anon;

alter table public.schools   enable row level security;
alter table public.profiles  enable row level security;
alter table public.devices   enable row level security;
alter table public.policies  enable row level security;
alter table public.commands  enable row level security;
alter table public.files     enable row level security;
alter table public.locations enable row level security;

-- schools -------------------------------------------------------------------

create policy schools_select on public.schools for select to authenticated
  using (public.can_view_school(id));
create policy schools_insert on public.schools for insert to authenticated
  with check (public.is_super_admin());
create policy schools_update on public.schools for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy schools_delete on public.schools for delete to authenticated
  using (public.is_super_admin());

-- profiles ------------------------------------------------------------------

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.can_view_school(school_id));

-- New staff need an auth user first, which only the service role can create,
-- so the dashboard adds people server-side. Direct inserts are super_admin-only
-- so a school admin can't attach a profile to an arbitrary account (e.g. a
-- device's). School admins edit/remove staff of their own school but never a
-- super_admin, and nobody edits their own role.
create policy profiles_insert on public.profiles for insert to authenticated
  with check (public.is_super_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (
    public.is_super_admin()
    or (public.can_manage_school(school_id) and role <> 'super_admin' and id <> auth.uid())
  )
  with check (
    public.is_super_admin()
    or (public.can_manage_school(school_id) and role <> 'super_admin' and id <> auth.uid())
  );
create policy profiles_delete on public.profiles for delete to authenticated
  using (
    public.is_super_admin()
    or (public.can_manage_school(school_id) and role <> 'super_admin' and id <> auth.uid())
  );

-- devices -------------------------------------------------------------------

create policy devices_select on public.devices for select to authenticated
  using (public.can_view_school(school_id) or auth_user_id = auth.uid());
create policy devices_insert on public.devices for insert to authenticated
  with check (public.can_manage_school(school_id));
revoke insert on public.devices from authenticated;
grant insert (school_id, student_name, student_id, model, manufacturer, serial)
  on public.devices to authenticated;
create policy devices_update on public.devices for update to authenticated
  using (public.can_manage_school(school_id)) with check (public.can_manage_school(school_id));
create policy devices_delete on public.devices for delete to authenticated
  using (public.can_manage_school(school_id));

-- Staff must not rewrite what the agent reports, or hijack a device account:
-- only these columns are writable from the dashboard. (A column-level revoke
-- would be a no-op while the table-level grant exists, hence revoke + grant.)
revoke update on public.devices from authenticated;
grant update (school_id, student_name, student_id, status, model, manufacturer, serial,
              enroll_token, enroll_token_expires_at)
  on public.devices to authenticated;

-- policies ------------------------------------------------------------------

create policy policies_select on public.policies for select to authenticated
  using (
    public.can_view_school(school_id)
    or device_id = public.current_device_id()
    or (device_id is null and school_id = (select d.school_id from public.devices d
                                           where d.id = public.current_device_id()))
  );
create policy policies_insert on public.policies for insert to authenticated
  with check (public.can_manage_school(school_id));
create policy policies_update on public.policies for update to authenticated
  using (public.can_manage_school(school_id)) with check (public.can_manage_school(school_id));
create policy policies_delete on public.policies for delete to authenticated
  using (public.can_manage_school(school_id));

-- commands ------------------------------------------------------------------

create policy commands_select on public.commands for select to authenticated
  using (public.can_view_school(school_id) or device_id = public.current_device_id());
create policy commands_insert on public.commands for insert to authenticated
  with check (
    status = 'pending'
    and created_by = auth.uid()
    and (
      public.can_manage_school(school_id)
      or (type = 'message' and public.can_view_school(school_id))
    )
  );
-- Admins may cancel/retry; devices report results via device_ack_command().
create policy commands_update on public.commands for update to authenticated
  using (public.can_manage_school(school_id)) with check (public.can_manage_school(school_id));
create policy commands_delete on public.commands for delete to authenticated
  using (public.can_manage_school(school_id));

-- files / locations: written by devices through RPCs ------------------------

create policy files_select on public.files for select to authenticated
  using (public.can_view_school(school_id));
create policy files_delete on public.files for delete to authenticated
  using (public.can_manage_school(school_id));

create policy locations_select on public.locations for select to authenticated
  using (public.can_view_school(school_id));
create policy locations_delete on public.locations for delete to authenticated
  using (public.can_manage_school(school_id));

revoke insert, update on public.files, public.locations from authenticated;
