# Wallpaper upload-or-delete flow

- Uploaded wallpapers are available automatically. There are no wallpaper enable, disable, withdraw or republish buttons.
- Shared wallpapers become available to all existing and newly created schools. School-only uploads remain school-scoped. Other library types retain their existing opt-in behavior.
- Existing wallpaper uploads, including previously withdrawn wallpapers, follow the same model once the migration is applied.
- The image's top-right × asks for confirmation. School admins can delete their school's uploads; only RoboKorda admins can delete a shared wallpaper for every school.
- Deletion removes the catalog row and attempts stored-image cleanup. Referential constraints remove school access rows and clear selected defaults. Devices receive the gallery update on their next online sync; this does not promise to erase offline copies or reset an already-applied background immediately.

## Release

Apply `20261018204234_wallpaper_automatic_availability.sql` before deploying the dashboard. The migration has been tested against an isolated Postgres engine, not applied to production by this change.

## Checks

Dashboard: `node --test scripts/wallpapers.test.mjs` and `npx tsc --noEmit`.

Database: from `supabase/tests`, run `node --test wallpapers.test.mjs`. These tests apply the migration, run actual SQL as separate users, and check device sync, privacy, deletion, new schools, and private trigger-helper permissions.
