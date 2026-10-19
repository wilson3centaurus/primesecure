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
