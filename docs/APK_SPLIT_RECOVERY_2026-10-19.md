# Split APK recovery — 19 October 2026

## Confirmed cause and device repair

- Primebook PF135 / Primebook-WiFi: Android 11 / API 30; ABIs arm64-v8a, armeabi-v7a, armeabi.
- Calculator `all.in.one.calculator` 3.4.0 (340) contained only base.apk. Crash: `libpairipcore.so` missing.
- Bible `com.sirma.mobile.bible.android` 11.34.1+7098322 contained only base.apk. Crash: missing resource `0x7f080182`.
- Verified all original publisher signatures and matching package/version values, then installed 5 Calculator / 4 Bible parts together using `adb install-multiple -r` on the user-designated test Primebook. Both launches returned `Status: ok`; both processes remained alive. User confirmed both open and work.
- No uninstall or app-data clear was performed.

## Backup and packages

- Copied complete folders from Pixel 6 Pro / SHAREit/apps into `C:\Users\XO\Desktop\Prime Secure\App Packages`.
- 62 folders, 237 files, 5,819,882,338 bytes. Source sizes checked; local SHA-256 inventory saved. Original phone files and previous base-only copies retained.
- 38 packages pass manifest, split-dependency and Android-11-baseline inspection. `.psapk` copies and compatibility-report.json are in `C:\Users\XO\Desktop\Prime Secure\Packaged Apps - Android 11`.
- 24 packages require API 32 or 33 and cannot be made Android-11-compatible just by recovering their splits.
- Packaging validation is not launch proof. Only Calculator and Bible have been launch-tested in this task; other apps may require Google Play services, accounts, network access or publisher licensing.

## Implementation

- App upload supports an app folder or parent of up to 100 app folders, producing one PrimeSecure `.psapk` ZIP per app. Each app supports up to 100 APK parts and 500 MB including the wrapper. Original signed APK bytes are unchanged.
- `.psapk` is NOT a bundletool `.apks` file. OBB expansion files are unsupported.
- Server rejects incomplete standalone bases, mixed packages/versions, duplicate parts, unsafe ZIP paths, missing declared split dependencies/types and minimum SDK above the Android 11 fleet baseline.
- PrimeSecure 0.9.1 / code 34 validates container SHA-256, APK signatures, package/version, dependencies, runtime SDK and actual native-library ABI support, then commits one PackageInstaller session. Manual retries repair same-version base-only installs without uninstalling.
- Older agents must be upgraded before `.psapk` distribution.
- Browser packaging uses chunked STORE ZIP processing, yields between chunks, and queues one app at a time to limit memory and retain pause/resume behavior.

## Verification before release

- 55 focused dashboard tests passed; TypeScript and targeted ESLint passed.
- Native worker reports 127 debug and 127 release tests, release build and lint passing, including real Calculator/Bible signed-package and tamper checks. Clean-source release verification and hosted deployment are separate gates.
- User authorized deployment plus an update to the connected test Primebook only, then requested server catalog repair for future enrollments. No fleet update, device wipe or unrelated app removal is authorized.
- Server recovery must preserve originals, catalog identities, school access and default settings, back up affected rows, and prevent old agents from receiving unsupported APK sets.

## Server and sync follow-up

- Uploader deployed from `f8f4fa2` to production deployment `dpl_EZtF3CEeMwMVMY99sRkJmJjnKppH`; live Edge test confirmed folder transfer and rejection of malformed splits and a split-dependent base-only APK. Its temporary QA account and two unreferenced test uploads were deleted.
- Compatibility migration `20261019003807_split_apk_catalog_compatibility.sql` applied with schema backup `/root/primesecure-backups/library-release-20261019T004059Z`; no services restarted. Transactional tests verified old/null/supported clients, direct-install gating, private helper grants and unenrolled denial. Versions below code 34 never receive `.psapk` catalog objects.
- Clean-source 0.9.1 / code 34 was signed with the fleet certificate and installed only on the authorized test Primebook. Device Owner remains intact.
- Full SDK audit: 38 local packages validated (including signatures and ARM ABI support); 24 excluded by minimum Android version. Live catalog matches: 34 repairable listings / 2,834,278,797 bytes; 16 minimum-SDK exclusions; 2 duplicate-identity quarantines (Duolingo / misnamed Math Games); 6 unmatched listings untouched. Four valid local apps have no corresponding catalog entry. Staging/publication has a separate reviewed plan and private rollback backup.
- User then reported stalled downloads and clarified priority: wallpapers, notes images, apps, notes documents (Robotics and Explore & grow retain priority within notes tiers).
- Actual WorkManager diagnostics: HubSync job 825 enqueued behind roughly 40 minutes of retry delay; outbox job 1088 behind approximately 3 hours. No HubSync running, validated network, 107 GB free. Sync used KEEP and therefore retained the delayed work. Temporary DNS failures were also visible in backend device diagnostics.
- 0.9.2 / code 35 adds explicit manual replacement of delayed sync/outbox jobs, cancellable HTTP I/O, one download reauthentication attempt, serialized token refresh, bounded transfer passes, periodic catalog refresh, resumable continuations, terminal APK error handling and visible sync errors. An APK upgrade restarts the old delayed chains without clearing durable tasks or partial files.
- Whole-catalog progress and recent task history are labeled separately. Native/browser tests and clean-source build must pass before installing code 35; the actual resumed wallpaper/image counters must be checked independently.
