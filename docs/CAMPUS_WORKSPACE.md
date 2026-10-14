# PrimeSecure campus workspace · agent 0.3.0

The student UI is bundled HTML, CSS and JavaScript inside the existing Android agent. It works offline after sync. Native code retains credentials, file access, policy enforcement, installations and message lock-task mode. Remote navigation and network scripts in the workspace WebView are blocked; user text is escaped. Android enrollment and the existing launcher are preserved.

## Student experience

- Home: school name, student identity and form/class, colorful cards for messages, notes, approved apps, wallpapers, shared files and device/support information.
- First opening: complete date of birth, home address, at least one parent/guardian phone and an optional personal phone. Saving needs internet; the accepted record remains cached for offline use. School administrators and the device can read this record; teachers and other schools cannot.
- Notes: Form → Subject → resource folder, with folder tiles, offline availability and hide/restore controls. The existing private-storage download mechanism continues. A native offline PDF reader handles PDFs when a preferred external reader is unavailable; EPUB and other formats require an approved compatible reader.
- Messages: named or anonymous-marked replies. The UI explicitly explains that school administrators can identify the sender. Replies are private to the sender and school staff; there is no student-public feed. Acknowledgement and opening are separate durable receipts. Reply submission needs internet; acknowledgements/opening are queued for retry offline.
- App Store: icons, names, descriptions, detected versions and install buttons. The native installer still checks current school approval and actual package identity.
- Files: safe shared-storage and mounted removable-drive navigation plus categorized images, video, music and documents. Removable drives are available only when the school permits them and Android grants access. Files open through exact, read-only content grants to the chosen/default viewer. Storage roots cannot be deleted. The agent never exposes another app’s private data.
- Support: Tafadzwa W. Sedze — 0787209882; Rodney Mavura — 0775009390. School workspace settings can update these contacts.

## Administrator experience

- Overview and navigation use the RoboCore-inspired blue/navy and violet palette with colored icon cards and supplied brand images.
- Student numbers are assigned by the database when adding a student without an ID. Existing custom IDs remain intact. Bulk addition accepts `Name, Form 2, 2A, Female`. Form/class/gender filters are available; device details let administrators edit grouping and view emergency records.
- School messages can target a form and/or class. Uploaded attachments go directly to private storage, then a small action verifies their scope, MIME type and size before queuing messages. This avoids submitting image bytes through Vercel Server Actions. The conversation page groups broadcasts, lists each recipient’s opened/acknowledged times and displays replies as `Student name (anonymous)` where requested.
- School Notes has folder navigation, current-folder uploads, drag/drop and batches of up to 50 files. With multiple resources, filenames become titles automatically. Shared resources still need explicit school opt-in.
- APK uploads automatically extract the package, version, label, icon and SHA256. Administrators do not type application identifiers or version numbers. Android still validates installation signatures.
- The App Store uses administrator-uploaded APKs only. Upload an APK, optionally override its display name, and publish it to school students or the shared RoboKorda library. The icon, label, version and application identifier are extracted automatically. Students download approved APKs from private server storage; there is no external discovery catalog.
- Workspace settings: block removable-media mounting, block USB file transfer, optionally hide known file managers, choose approved media viewers by name and configure support contacts. Selected viewers are preinstalled from the available school catalog. Controls are off by default. Hiding file managers is not a universal ban on every app that can display files; use the existing package policy for additional applications.

## Cache, location and enforcement limits

The agent requests inventory/location sync about every five minutes while its foreground service is running, with a 15-minute WorkManager fallback. Android sleep, networking and OEM scheduling can delay it. File metadata uploads only when its entry digest changes; unchanged snapshots receive a small freshness update. Image thumbnails are reused until size/modified time changes. Cached inventories and the existing last-reported location remain readable when the device is offline.

Snapshots are bounded to 5,000 accessible shared-storage entries, depth 12, under 2 MB, and up to 24 small JPEG previews. The dashboard reports truncation and inaccessible folders. Live folder operations remain available for other shared folders while online. Original media is not continuously copied to the server. Inventory access is restricted to school administrators. IP-derived positions remain city-level estimates, clearly separated from GPS/network positions by the existing location panel.

The previous external catalog import interface has been retired. Existing imported apps remain normal library items, and historical import tables and worker scripts are retained for queued-job compatibility. New apps are published through administrator APK uploads.

PrimeSecure requests a shortcut automatically once, and provides a manual request button. The existing Primebook launcher decides whether to accept pinning, where to place the icon and whether it can be unpinned. Keeping that launcher means permanent pinning cannot be guaranteed. Uninstall protection remains enforced through Device Owner. USB restrictions cover physical media mounting and file transfer, not all USB peripherals such as keyboards and mice. PrimeOS must be tested for actual enforcement.

## Rollout and checks

Apply `20261013223649_campus_experience.sql` transactionally as the existing table owner. Back up the PrimeSecure device/command/library tables first. Never reset the shared database. The server backup for this rollout is `/root/primesecure-backups/pre-campus-20261014.sql`.

The historical `20261013232153_app_import_queue.sql` migration remains part of the database history; an external catalog worker is not required for APK uploads.

Update the enrolled test Primebook with the same signing certificate, preserving app data:

```sh
adb install --no-streaming -r -t /sdcard/Download/PrimeSecure-0.3.0-debug.apk
```

Do not uninstall, clear app data or change signing keys. Debug/testOnly builds remain ADB test builds; fleet production still requires a persistent release signing key.

Validation includes Android assemble/lint, dashboard lint/build, database authorization tests, browser tests of the bundled student screens, and authenticated dashboard/backend tests in a temporary school. Those checks do not prove PrimeOS window enforcement, pinning, USB blocking, hardware battery readings or third-party application compatibility; confirm these on the real Primebook.


For the 0.4 offline queue, built-in viewers and password recovery, see [OFFLINE_WORKSPACE.md](OFFLINE_WORKSPACE.md).
