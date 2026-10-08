# PrimeSecure

Self-hosted MDM for PrimeOS (Android 11) student Primebooks.

| Path | What |
| --- | --- |
| `agent/` | Kotlin Device Owner agent (`com.robokorda.primesecure`) |
| `dashboard/` | Next.js dashboard (Vercel) — see [dashboard/README.md](dashboard/README.md) |
| `supabase/` | Migrations, edge functions, and DB tests for the self-hosted Supabase on Contabo |
| `.github/workflows/` | CI: debug APK build, dashboard lint + build (signed release workflow comes in step 7) |

Tenancy: RoboKorda (`super_admin`) → schools (`school_admin`, `teacher`) → devices. Isolation is
enforced in Postgres RLS on `school_id`; see `supabase/migrations/20261008000002_rls.sql`.

## Build order and status

1. ✅ Supabase schema + RLS + auth — `supabase/`, tested with `cd supabase/tests && npm test`
2. 🧪 Agent enroll + check-in + policy apply — **needs testing on a real Primebook**
3. 🧪 Dashboard: login, schools, staff, devices + enroll tokens, school and device policies
4. 🧪 Commands: messages (instant via Realtime), lock / suspend / retire as device states
5. ⬜ Location
6. ⬜ File push + browser
7. ⬜ Self-update + signed release workflow

## Backend

See [docs/SETUP.md](docs/SETUP.md): apply migrations, deploy the `enroll` function, create the
first super_admin, and issue an enroll token for a test device.

How a device authenticates: the dashboard creates a `devices` row, which carries a single-use
8-character enroll token (7-day expiry). The agent sends the token to the `enroll` edge function,
which creates a dedicated auth user for that device and returns its credentials. From then on the
agent signs in as itself; RLS lets it read only its own device row, policy and commands, and it
writes only through `device_check_in()` / `device_ack_command()`.

## Agent

### Build

Bake the backend into the APK (the anon key is public by design):

```bash
cd agent && ./gradlew assembleDebug -Pprimesecure.url=https://supabase.example.com -Pprimesecure.anonKey=eyJ...
```

or set the `PRIMESECURE_URL` / `PRIMESECURE_ANON_KEY` repository **variables** and download the
`primesecure-agent-debug` artifact from the GitHub Actions run.

Debug builds are `testOnly` (adb can remove the Device Owner without a factory reset) and allow
plain-HTTP servers. Release builds are neither.

### Provision a Primebook

Device Owner can only be set while the device has no accounts.

1. Settings → Accounts: remove every account (Google etc.).
2. Connect adb (Termux on the device, or from a PC):
   ```bash
   adb connect localhost:<port>
   ```
3. Install and make it Device Owner:
   ```bash
   adb install -t app-debug.apk
   ```
   ```bash
   adb shell dpm set-device-owner com.robokorda.primesecure/.AdminReceiver
   ```
4. Enroll with the token from the dashboard (add `--es server_url ... --es anon_key ...` if the
   build doesn't have them baked in):
   ```bash
   adb shell am start -n com.robokorda.primesecure/.MainActivity --es token K7QF-M2XP
   ```
5. Re-add the accounts.

### Step 2 test checklist (one real Primebook)

Run the queries in the Supabase SQL editor.

- [ ] Agent screen shows **Device Owner: YES**, then a Device ID and **Status: active** after enrolling.
- [ ] `select status, model, serial, android_id, os_version, battery_level, last_ip, last_seen_at from devices;`
      shows the Primebook's real details.
- [ ] Add a school policy and tap **Check in now**:
      ```sql
      insert into policies (school_id, wallpaper_url, lock_wallpaper, block_installs, hide_settings)
      values ('<school id>', 'https://<supabase-host>/storage/v1/object/public/wallpapers/<school id>/wall.png', true, true, true);
      ```
      Wallpaper changes and can't be changed by hand; Settings disappears; installing an APK from Files is blocked.
- [ ] `update policies set hidden_apps = '{com.android.chrome}' ...` → Chrome disappears from the launcher.
- [ ] `update policies set allowed_apps = '{com.android.chrome}' ...` → only Chrome (+ launcher, keyboard, PrimeSecure) remains.
- [ ] `delete from policies;` → Check in now → everything comes back (wallpaper stays as last set).
- [ ] Reboot → `last_seen_at` updates within a minute or two without opening the app.
- [ ] Leave it 30+ minutes → `last_seen_at` keeps advancing (15-minute periodic check-in).
- [ ] Debug escape hatch: **DEBUG: undo policies + release Device Owner** restores the device and drops Device Owner.

### Undo without the app

```bash
adb shell dpm remove-active-admin com.robokorda.primesecure/.AdminReceiver
```
(debug / `testOnly` builds only)

### Step 3–4 test checklist (dashboard + one enrolled Primebook)

- [ ] Sign in as the super_admin → **Schools**: add a school; the sidebar switcher selects it.
- [ ] **Staff**: add a school admin; sign in as them in a private window → they only see their school.
- [ ] **Devices → Add devices**: one line per student → each gets a token; enroll the Primebook with it → status turns **Active** and online without reloading.
- [ ] **School policy**: upload a wallpaper, lock it, hide Settings → saved; the Primebook changes within seconds (Realtime) or at the next check-in.
- [ ] Device page → **Message the student** → the message pops up on the Primebook; history shows **Done**.
- [ ] Turn the Primebook's Wi-Fi off, send a message, turn it back on → it arrives on reconnect.
- [ ] **Lock device** with a message → full-screen lock; Home/Recents don't escape; reboot → still locked. **Unlock** → back to normal.
- [ ] **Suspend** → only allowed apps (from the policy) remain; **End suspension** → apps come back.
- [ ] The agent keeps a "managed by your school" notification; Realtime reconnects after Wi-Fi drops (watch a message arrive).
- [ ] **Retire** (debug device you can re-provision) → restrictions lifted, Device Owner released.

## Notes for later steps

- `MANAGE_EXTERNAL_STORAGE` (step 6) is an app-op, not a runtime permission, so Device Owner can't
  grant it to itself; provisioning will add
  `adb shell appops set com.robokorda.primesecure MANAGE_EXTERNAL_STORAGE allow`.
- `DISALLOW_INSTALL_APPS` also blocks the Device Owner's own silent installs, so `block_installs`
  currently blocks unknown sources only; Play Store can be hidden via `hidden_apps`
  (`com.android.vending`). Install commands (step 4) will lift restrictions around their own install.
- The release signing key (step 7) is created once and must be backed up: losing it means
  re-provisioning every device.
