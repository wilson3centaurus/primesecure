-- Storage buckets. Every object path starts with the owning school's id:
--   apks/<school_id>/<name>.apk   media/<school_id>/<file>   wallpapers/<school_id>/<file>
-- wallpapers is public so the agent can fetch policy.wallpaper_url directly;
-- apks and media are private and read with the caller's JWT.

insert into storage.buckets (id, name, public)
values ('apks', 'apks', false), ('media', 'media', false), ('wallpapers', 'wallpapers', true)
on conflict (id) do nothing;

create function public.try_uuid(p text)
returns uuid
language plpgsql immutable set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

create function public.storage_school_id(object_name text)
returns uuid
language sql immutable set search_path = ''
as $$ select public.try_uuid(split_part(object_name, '/', 1)) $$;

grant execute on function public.try_uuid(text), public.storage_school_id(text) to authenticated, service_role;

create policy primesecure_objects_select on storage.objects for select to authenticated
  using (
    bucket_id in ('apks', 'media', 'wallpapers')
    and (
      public.can_view_school(public.storage_school_id(name))
      or public.storage_school_id(name) = (select d.school_id from public.devices d
                                            where d.id = public.current_device_id())
    )
  );

create policy primesecure_objects_insert on storage.objects for insert to authenticated
  with check (
    bucket_id in ('apks', 'media', 'wallpapers')
    and public.can_manage_school(public.storage_school_id(name))
  );

create policy primesecure_objects_update on storage.objects for update to authenticated
  using (
    bucket_id in ('apks', 'media', 'wallpapers')
    and public.can_manage_school(public.storage_school_id(name))
  )
  with check (
    bucket_id in ('apks', 'media', 'wallpapers')
    and public.can_manage_school(public.storage_school_id(name))
  );

create policy primesecure_objects_delete on storage.objects for delete to authenticated
  using (
    bucket_id in ('apks', 'media', 'wallpapers')
    and public.can_manage_school(public.storage_school_id(name))
  );
