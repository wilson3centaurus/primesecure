# PrimeSecure student hub (agent 0.2.0)

The existing agent APK now includes the student hub. Updating an enrolled device preserves enrollment; new enrollment opens the hub automatically. Its launcher entry is PrimeSecure. The management/enrollment activity no longer exposes configuration or the debug release button once enrolled.

## Dashboard workflows

- **Messages:** send an ordinary inbox message or select **Acknowledgement required**. Required messages use Android lock-task mode until **I acknowledge**. Delivery status and the student's acknowledgement timestamp are separate. Text, `# Heading`, pipe-separated table rows, an uploaded JPG/PNG/WebP (up to 3 MB), and HTTPS image URLs are supported. Uploaded images are private to the school. Inbox text persists offline; images are cached once opened.
- **School Notes:** publish a file under Form → Subject → Notes / Past exam papers / Textbooks / Images / Videos / Other resources. Students can hide and restore individual resources, entire subjects, and forms. Downloads stay inside app-private storage; viewers receive read-only file grants. Downloads resume after interruption where the storage server supports HTTP ranges. Low storage pauses downloading with an explanation. Revoking a catalog item removes it from the next synced view; it cannot recall copies already opened in another app.
- **Approved Apps:** publish APKs with their actual Android package name. Optional automatic installation queues them for active enrolled devices. Apps disallowed by the effective hidden/allowed-app policy are omitted and cannot be requested for installation. The agent rechecks approval before download and verifies that the APK package matches. Existing administrator deployments remain available separately. A review marked “approved” does not itself publish an APK.
- **App requests:** students submit a name and reason (maximum 10 requests per device per day); school administrators review them.
- **Wallpapers:** upload approved images and set school or RoboKorda master defaults. A school default takes precedence over the global one; approved student choices take precedence when enabled. Withdrawn choices fall back to the default. The existing wallpaper policy continues when no gallery/default wallpaper is selected. Changes usually arrive at the next online check-in (15-minute fallback), but sleep/offline states can delay them.
- **School policy:** existing Settings hiding, package hiding and allowed-app lists remain available. Wallpaper settings also offer hiding `com.floydwiz.primestore` and blocking unknown-source installs. These controls must be configured for the intended school; updating the agent does not silently hide the existing store or Settings.
- **Battery diagnostics:** device details show Android's reported health, temperature, voltage and remaining charge where exposed. Unsupported values stay unavailable. “Good” is not proof of original capacity; this does not provide a reliable wear percentage or certify that a battery needs replacing.

## Shared content and access

School uploads belong to that school. Only RoboKorda super administrators publish shared items. Each school enables shared resources/apps/wallpapers explicitly. Master wallpapers can be downloaded as defaults without also enabling them in the student gallery. Device RPCs resolve identity from `auth.uid()`; students cannot publish, delete catalog entries, forge another device's acknowledgement, or access another school's uploads. Acknowledgements upload separately from large resource downloads.

## Stock Primebook launcher limits

The existing launcher is preserved. PrimeSecure is protected from uninstall and excluded from policy-driven hiding. **Pin PrimeSecure** requests a shortcut through Android; the launcher decides whether it supports pinning and whether a user can remove that shortcut. Preventing unpinning, forcing taskbar placement or controlling desktop icon movement is not guaranteed by Android's standard device-owner APIs. Full-screen acknowledgement must be validated on PrimeOS's freeform windows with Home, Back, window-close, reboot and multiple queued notices. Ordinary messages never intentionally enter lock-task mode. An administrator's device lock has priority over notices.

## Deployment and verification

1. Apply `supabase/migrations/20261013200726_student_hub.sql` transactionally with the owner of the existing PrimeSecure tables (`supabase_admin` on the current self-hosted server), then `NOTIFY pgrst, 'reload schema'`. Back up `devices` and `commands` first. Do not recreate or reset the shared database.
2. Deploy the dashboard using the existing Vercel project/environment.
3. Install the APK over the existing debug agent using the same signing key: `adb install -r -t app-debug.apk`. Do not uninstall or clear app data. Debug/testOnly APKs are for ADB testing; use a consistently signed non-testOnly release for fleet deployment. Never switch signing certificates on an enrolled installation.
4. Check in, confirm agent 0.2.0, test an ordinary message then a mandatory notice, acknowledge it and reopen it from the inbox. Confirm the dashboard timestamp.
5. Publish a sample resource, download it, disconnect networking and open it. Hide/restore the form and subject. Test an interrupted download and low-storage handling.
6. Enable a shared app for one school only. Test install success, wrong-package rejection, withdrawal before execution, and a student request. Configure school policy if outside installs/Settings/vendor store should be restricted.
7. Choose an approved wallpaper and verify the actual device changes. Test school/global fallback and disabling student choice. Confirm battery readings against the device.

Local checks: `cd supabase/tests && npm test`; `cd dashboard && npm run lint && npm run build`; `cd agent && gradlew.bat assembleDebug lintDebug` with server URL/anon key supplied through environment variables. Build/lint/database tests do not prove PrimeOS window enforcement or OEM installation behaviour; those need the physical Primebook.
