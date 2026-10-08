# PrimeSecure dashboard

Next.js app for RoboKorda and school staff. Every query runs as the signed-in
user, so Postgres RLS decides what they see; the service-role key is used only
server-side to create, reset and remove staff logins (after the same checks RLS
would make).

## Run locally

```bash
cp .env.example .env.local   # fill in the anon and service-role keys
npm install
npm run dev
```

## Pages

| Page | Who | What |
| --- | --- | --- |
| `/devices` | all staff | Device list: online/offline, battery, status, search; admins add devices (bulk, one student per line) and get enroll tokens |
| `/devices/[id]` | all staff | Device details, enroll token / re-issue, student details, delete |
| `/devices/[id]/policy` | admins edit | Per-device policy that replaces the school policy |
| `/policy` | admins edit | School-wide policy: wallpaper upload, wallpaper lock, block installs, hide Settings, hidden / allowed apps |
| `/staff` | admins edit | Add teachers and school admins, change role, reset password, remove |
| `/schools` | super_admin | Add and rename schools; the sidebar switcher picks the school to work in |

Teachers can view everything in their school but change nothing (they will be
able to send messages once commands land).

## Deploy (Vercel)

Before the first deploy, on the Supabase server:

1. **Rotate the JWT secret and keys** if `docker/.env` still has the Supabase demo values
   (`"iss": "supabase-demo"`). Anyone can forge admin tokens with those.
2. Apply every migration: `supabase db push --db-url "postgresql://postgres:<password>@<host>:5432/postgres"`.
3. Check that Realtime is running (`docker compose ps realtime`); live updates and instant commands use it.

Then in Vercel:

1. **Add New → Project →** import `wilson3centaurus/primesecure`, **Root Directory** `dashboard`
   (the framework is detected as Next.js).
2. Environment variables (Production + Preview):
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://api.robokorda.duckdns.org`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the anon key
   - `SUPABASE_SERVICE_ROLE_KEY` = the service-role key, type **Sensitive**. Type it straight into Vercel and don't paste it anywhere else.
3. Deploy. Production deploys come from `main`, so merge the work branch first.
4. In Supabase, set **Auth → URL configuration → Site URL** (`SITE_URL` in `docker/.env`) to the Vercel domain.
