-- Keep the existing device/storage authorization path, but grant shared wallpapers
-- automatically. Apps, notes and media retain their school opt-in behavior.
create schema wallpaper_internal;
revoke all on schema wallpaper_internal from public, anon, authenticated;

create function wallpaper_internal.publish_wallpaper_automatically() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'wallpaper' then new.published := true; end if;
  return new;
end $$;
revoke all on function wallpaper_internal.publish_wallpaper_automatically() from public, anon, authenticated;
create trigger wallpaper_always_published before insert or update on public.hub_items
for each row execute function wallpaper_internal.publish_wallpaper_automatically();

-- These trigger-only functions need definer privileges to grant access across
-- schools. They are outside the API schema, with no callable client privileges.
create function wallpaper_internal.share_uploaded_wallpaper() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'wallpaper' and new.school_id is null then
    if auth.uid() is not null and not coalesce(public.is_super_admin(), false) then
      raise exception 'RoboKorda administrator required for shared wallpapers';
    end if;
    insert into public.hub_access(item_id, school_id)
      select new.id, s.id from public.schools s on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function wallpaper_internal.share_uploaded_wallpaper() from public, anon, authenticated;
create trigger wallpaper_auto_access after insert or update on public.hub_items
for each row execute function wallpaper_internal.share_uploaded_wallpaper();

create function wallpaper_internal.share_wallpapers_with_new_school() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not coalesce(public.is_super_admin(), false) then
    raise exception 'RoboKorda administrator required to create schools';
  end if;
  insert into public.hub_access(item_id, school_id)
    select i.id, new.id from public.hub_items i
    where i.kind = 'wallpaper' and i.school_id is null and i.published
    on conflict do nothing;
  return new;
end $$;
revoke all on function wallpaper_internal.share_wallpapers_with_new_school() from public, anon, authenticated;
create trigger school_wallpaper_auto_access after insert on public.schools
for each row execute function wallpaper_internal.share_wallpapers_with_new_school();

-- Existing uploads follow the same upload-or-delete model, including wallpapers
-- previously withdrawn or never explicitly enabled for an individual school.
update public.hub_items set published = true where kind = 'wallpaper';
