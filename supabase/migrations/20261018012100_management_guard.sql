-- Permission helpers must return false, never NULL, for device/non-staff accounts.
-- This also keeps procedural `if not can_manage_school(...)` checks fail-closed.
create or replace function public.can_manage_school(sid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(public.is_super_admin() or (sid is not null and sid=public.auth_school_id() and public.auth_role()='school_admin'),false)
$$;
