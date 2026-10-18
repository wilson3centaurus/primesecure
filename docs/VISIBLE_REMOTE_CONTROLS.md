# Visible remote controls and case classification

The database migration and dashboard are deployed; the signed 0.9.0/code 33 APK
is prepared for the user's three-device pilot, without fleet activation.
See `LIBRARY_SETUP_RELEASE_2026-10-19.md` for exact evidence and outstanding
physical checks. Native controls require installing that compatible APK.

## Alarm

- Device page → Visible, authorized remote controls. Requires a school administrator, documented authorization checkbox and a 5–500-character reason; each request is audited.
- Connected agents receive the normal realtime command signal. Offline requests expire after two minutes and never ring later.
- `AgentService` uses a separate authenticated urgent fetch on connection, urgent-command signals and its 30-second safety poll. It does not wait for the normal bulk-command/download mutex. This is a small, deliberate integration hook outside the alarm classes; library download logic is unchanged.
- Duration is 5–30 seconds, server and agent checked. Requests are rate-limited per device to one per minute. Duplicate command delivery cannot replay or extend an alarm.
- A foreground notification and on-device screen provide Stop. Back also stops the alarm. Maximum alarm stream volume is temporarily requested; DND/device audio policy is not bypassed. Android audio playback startup is reported separately from proof that speakers were audible.
- Normal stop, timeout, playback failure and service destruction restore the journalled previous alarm volume. If Android kills the process, service recreation restores the journal and stops instead of replaying. Force-stop/reboot behavior and OEM background-activity restrictions require physical Primebook QA; immediate volume restoration after an arbitrary process kill is not guaranteed.

## Photo and screenshot requests

- The command result says `awaiting_student_consent`, not capture complete. A separate session records offered → consented → completed/declined/failed.
- Only the enrolled target device can consent or submit a result for its exact request. Cancellation, expiry, another device, other school, teacher and anonymous access are denied.
- Tap the visible notification to allow or decline. Camera uses the device camera app with a front-camera preference (not a guarantee). Nothing invokes the camera silently; no microphone permission is requested.
- Screenshot uses Android MediaProjection consent and a foreground `mediaProjection` service. There is a visible Stop action, one frame after a five-second countdown and a 12-second session deadline. No root, accessibility screen reading or protected-screen bypass is used. Android `FLAG_SECURE` content remains protected.
- Student must review and send the single image. Discard/decline never uploads it. Screen previews stay in app-private cache for review, are rejected after two minutes, deleted on review or a running-process timer, and stale cache is removed on the next capture request. A device crash can delay physical cache cleanup; expired previews cannot be opened by this flow.
- Images are JPEG, at most 260 KB / 1280-pixel longest side. No image bytes are placed in the command log, regular device media, or public object storage.
- Private image storage is the `remote_capture_frames` database table, protected by RLS. Only administrators of that school can read an unexpired image. The dashboard image endpoint additionally requires the selected school and sends `private, no-store`, `nosniff` and restrictive CSP headers.
- Case-linked requests appear under that case. Other requests appear in device capture history. Capture actions are audited.
- Server images become inaccessible after seven days. With existing `pg_cron`, the migration schedules owner-only physical deletion every 15 minutes. If `pg_cron` is absent, deployment MUST configure an owner-only maintenance job to run `select remote_control_internal.purge_expired_frames()` every 15 minutes. The migration does not install extensions or configure an external scheduler. Database backups may have separate retention.

## Case false positives

Only the exact package IDs below are exempt from automatic unapproved-app case creation:

- `com.android.launcher3`
- `com.android.documentsui`
- `com.floydwiz.primesetup`
- `com.floydwiz.primeos.appcompat`

This does not permit these apps under device app rules, exempt other OEM packages, trust display labels or allow arbitrary `com.android.*` / `com.floydwiz.*` apps. Existing system flags and approved-app rules remain in effect. All aggregate usage stays in reports.

Migration resolves untouched open automatic cases for those IDs and records why in evidence; staff notes, observing/resolved cases and manual cases are preserved.

## Not implemented / not claimed

- Livestreaming, covert camera/screen capture, hidden Google tracking accounts or automatic Google-password enrollment.
- Automatic five-screenshot incident collection. There is no ongoing authorized incident-capture session or event hook; this release deliberately permits one explicitly reviewed image per request, below the agreed maximum of five.
- Physical-device audio, camera, screen-sharing, notification-denial and OEM power-management verification. Unit tests/builds do not prove those behaviors.

## Local verification

- `cd dashboard; node --test scripts/remote-controls.test.mjs`
- `cd dashboard; npx tsc --noEmit`
- `cd supabase/tests; node --test remote-controls.test.mjs`
- `cd agent; .\gradlew.bat :app:compileDebugKotlin :app:testDebugUnitTest --console=plain`

The dedicated database suite applies tracked baseline migrations plus this migration in PGlite, independent of parallel agents' unfinished migrations. It verifies school/device/anonymous boundaries, exact-package false positives, audited bounded alarms, explicit consent and JPEG expiry/purge behavior.
