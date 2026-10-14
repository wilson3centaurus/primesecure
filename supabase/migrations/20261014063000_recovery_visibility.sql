-- Temporary password commands are visible only to administrators and their target device.
drop policy commands_select on public.commands;
create policy commands_select on public.commands for select to authenticated using(
 device_id=public.current_device_id() or (public.can_view_school(school_id) and (type<>'reset_password' or public.can_manage_school(school_id)))
);
