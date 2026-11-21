-- App Store APKs may be up to 500 MB. Other library types retain their
-- application-level limits in the dashboard publish path.
update storage.buckets
set file_size_limit = 500000000
where id in ('primesecure-hub', 'apks');

drop policy if exists hub_items_write on public.hub_items;
create policy hub_items_write on public.hub_items for all to authenticated
  using (public.can_manage_school(school_id) or (school_id is null and public.is_super_admin()))
  with check (public.can_manage_school(school_id) or (school_id is null and public.is_super_admin()));
