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
