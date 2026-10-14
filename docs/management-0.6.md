# PrimeSecure 0.6.0

The student workspace now presents a flat Media library: Documents, Videos, Music and Pictures. Directories and filesystem breadcrumbs are omitted. App Store tiles use large icons, app names, version, size and install state; no fabricated ratings appear.

## Native changes

Wallpaper decode, device-policy calls and WallpaperManager writes run on an IO dispatcher, serialized by a mutex. Image decode is sampled to a maximum 2560-pixel edge. Remote wallpaper bodies are capped at 20 MB. The wallpaper restriction is restored and the bitmap is recycled after applying it. These remove a known UI-thread blocking path; a real Primebook test is still required to establish whether all reported ANRs are resolved.

The hub reads task progress off the UI thread, prevents overlapping state refreshes, and caches expensive device/runtime scans for a minute. The web interface avoids redrawing unchanged state.

School-selected viewers take priority over built-in viewers. Books/PDFs, Word/text documents, videos, pictures and music have separate choices. Approved viewers install automatically through the existing queue. Android persistent defaults are registered for MIME types the installed viewer resolves; native fallbacks remain available when a selection cannot open a file. This requires 0.6.0 and a physical test of each selected viewer.

## Administration

- **Content & files:** School notes, Wallpapers, Device media and File transfers.
- **Apps:** App Store, Student requests, App rules, Media viewers and Older deployments.
- **Settings:** Device/support controls, Forms/classes, Web filtering and Wallpaper defaults.

Old Files, Requests, Wallpapers and School policy links redirect to the corresponding section. Saving media-viewer choices does not reset USB controls or support contacts. Web-filter edits preserve unrelated legacy policy values.

App Store approval is the default app rule. A published, school-owned app or a shared app enabled for the school is allowed; withdrawing or disabling it revokes approval. On 0.6.0, other launchable student apps, Settings and the vendor store are hidden/blocked. If Android refuses hiding, suspension is attempted. Launcher, current keyboard, Android System UI and PrimeSecure are protected. Apps without launcher activities are not indiscriminately disabled. Application data is retained. Failures appear in the policy report.

Administrators can temporarily disable catalogue-only enforcement in Apps → App rules for troubleshooting. In particular, unapproved Termux/terminal apps will be hidden after installing 0.6.0. The current test APK needs `adb install --no-streaming -r -t`; this release is not activated as a fleet-wide native update.

## Messages

History uses compact expandable notices, receipts and reply rows. School admins can delete their school's notices; teachers can delete only notices they created. Deletion cancels pending delivery and adds a deletion marker while preserving audit payloads and receipts. Upgraded Primebooks remove their local copy on sync and dismiss a recalled notice if it is open. Offline devices cannot be recalled until they reconnect; 0.5.0 does not process deletion markers.

History aggregates the latest 25 notices in Postgres, preserving complete fleet receipts without repeating the entire body per student. Deleting a selected representative expands to its broadcast within the same school and sender. The database suite verifies a full 300-device broadcast and whole-broadcast deletion.

Native UI bundles use a build-time version from the same epoch as web releases. A newer APK will not load an older cached interface over its bundled workspace.
