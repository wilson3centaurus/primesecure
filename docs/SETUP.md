# Backend setup (self-hosted Supabase on Contabo)

## 1. Apply migrations

From the repo root, against the Contabo Postgres (direct port, not through Kong):

```bash
supabase db push --db-url "postgresql://postgres:<password>@<contabo-host>:5432/postgres"
```

Migrations live in `supabase/migrations/`. They are tested in-process with
PGlite before every commit:

```bash
cd supabase/tests && npm install && npm test
```

## 2. Deploy the `enroll` edge function

Self-hosted Supabase serves functions from the `functions` container's volume.
Copy `supabase/functions/enroll/` to `docker/volumes/functions/enroll/` on the
server, then restart the container:

```bash
docker compose restart functions
```

Check it answers (expects `invalid_token`):

```bash
curl -s -X POST https://<supabase-host>/functions/v1/enroll -H "Authorization: Bearer <anon-key>" -H "Content-Type: application/json" -d '{"token":"x"}'
```

## 3. Lock down auth

In the server's `.env`, disable public sign-ups — staff accounts are created by
admins, device accounts by the `enroll` function:

```
DISABLE_SIGNUP=true
```

## 4. Create the first super_admin

1. Studio → Authentication → Add user (email + password, auto-confirm).
2. SQL editor:

```sql
insert into public.profiles (id, role, full_name)
values ('<auth user uuid>', 'super_admin', 'RoboKorda Admin');
```

## 5. Create a school and a test device (until the dashboard exists)

```sql
insert into public.schools (name) values ('Rusununguko ZIMFEP High School') returning id;

insert into public.devices (school_id, student_name)
values ('<school id>', 'Test Primebook')
returning id, enroll_token, enroll_token_expires_at;
```

The `enroll_token` (e.g. `K7QF-M2XP`) is valid for 7 days and single-use. To
issue a fresh one for an existing device:

```sql
update public.devices
   set enroll_token = public.gen_enroll_token(), enroll_token_expires_at = now() + interval '7 days'
 where id = '<device id>'
returning enroll_token;
```
