# Split APK recovery and setup sync

## Verified scope

- School: Rusununguko ZIMFEP High School only. No enrollment, student data or installed apps were removed.
- Pilot device: PF135, Android 11/API 30, ARM64, device ID `23893643-e4c4-4b39-bc30-c9af77721c97`.
- Original phone backup: `Desktop/Prime Secure/App Packages`, 62 folders, 237 files, 5,819,882,338 bytes. The phone and older base-only copies are retained.
- Calculator and Bible failed because required splits were missing. Complete original, publisher-signed sets were installed without uninstalling either app. Both launched and the user confirmed they work.

## Implemented safeguards

- Dashboard folder picker packages a complete app folder into a flat `.psapk` ZIP without changing or re-signing APK bytes. Up to 100 apps, 500 MB per complete app.
- Manifest checks reject mismatched packages/versions, missing required splits and unsupported API levels. Native installation also verifies every APK signature and the actual device ABI/API before one atomic PackageInstaller session.
- Android 11 is the audited catalog baseline, not a guarantee of compatibility with every device or Google Play licensing requirement.
- Clients below code 34 cannot receive or request `.psapk` installs. The deployed compatibility migration preserves existing school access and default-install rules.
- Original stored objects remain available for recovery. Only reviewed catalog storage metadata and unsafe app visibility may change.

## Sync diagnosis and physical evidence

- Before the fix, WorkManager kept hub sync behind approximately 40 minutes of retry backoff and the outbox behind approximately three hours. Ordinary Sync used KEEP, so it retained delayed work.
- Explicit Sync now replaces delayed hub/outbox work, while routine scheduling keeps active work. APK replacement also resumes the queues without clearing enrollment or saved files.
- Transfers run in bounded passes with resumable downloads and real HTTP cancellation. A failed item cannot indefinitely starve later streams.
- Priority: wallpapers, notes images, apps, notes documents; Robotics and Explore & grow take precedence within notes, then smaller files.
- On the pilot, wallpapers progressed from 57/85 to 85/85; notes then progressed from 482 to 1227/2653, including Robotics images. Manual Sync cancellation/restart was observed in WorkManager logs. The later physical screenshot shows 1476 pending jobs, not the old limited 50-history count.
- The old 50 badge was a limited recent-task count, not a catalog total. The new UI uses complete setup totals plus separate non-setup jobs, labels unknown totals as recent history, and identifies historical transfer errors explicitly.
- Code 37 also reuses a full interrupted APK cache only after fresh SHA verification, restarts an HTTP416 range failure once, and retains bounded task-owned bytes on cancellation. Hash, signature, package and approval checks are never skipped.
- Paused automatic rollout: only the named test Primebook was updated. Fresh-device provisioning and all third-party app launches are not established by build checks.
- On the continuation, the test device had a separate network failure: public-IP ping succeeded, but DNS lookup failed for the API and Android/Google connectivity probes. Its DHCP DNS was the PC hotspot at `192.168.137.1`. The user authorized a Private DNS trial; school policy blocked it, and both settings remained unset. No management protections were relaxed. After the user switched network and reconnected ADB at port 38555, API DNS resolved, CheckIn/HubSync workers succeeded, and the backend reported 1327 notes at 11:54 UTC. This is not proof that all downloads have completed.

## Storage upload expiration

- Storage v1.48.26 defaulted signed upload links to 60 seconds. The server logged a large upload failing with `"exp" claim timestamp check failed`.
- Set `UPLOAD_SIGNED_URL_EXPIRATION_TIME=7200` in the storage service only; verified a new token has a 7,200-second lifetime. Bucket privacy, RLS and signing keys were unchanged.
- Storage was recreated, not the VPS, database, auth or gateway. The other three container IDs were checked unchanged and storage health was verified.
- Private backup: `/root/primesecure-backups/upload-ttl-20261019T013632Z`.
- A real public signed upload succeeded with a 144-second-old token, its stored bytes passed SHA verification, and the temporary object and private token-state file were removed. The evidence is in `delayed-upload-proof.json` inside that backup.

## Catalog replacement status

- Approved plan SHA-256: `f3c9bccf482f8ff0cdb46ba5d5c01c1c73c15f1ab20fed9636c0d802ab42030d`.
- Planned: 34 matched compatible sets; withdraw 16 requiring newer Android and two duplicate/misidentified listings. Unmatched catalog entries are unchanged.
- All 34 archives passed SDK signature, manifest, dependency, size and byte-integrity checks. This does not prove every app launches.
- Recovery staging reuses 2,076,964,792 verified base bytes on the server. Only 757,297,515 split bytes and 16,490 ZIP metadata bytes need transfer; reconstructed archives must exactly match approved SHA-256 values before immutable storage upload.
- Publication remains pending until every staged object is verified. The publication tool backs up existing catalog/access/default rows privately, checks drift under locks, preserves access/defaults and retains original objects.

## Checks

- Dashboard folder/upload/validation tests: 55 passed; TypeScript and targeted lint passed.
- Student Favorites/workspace tests: 13 passed; browser setup-stream tests include full counters, numeric-only updates, unknown totals, historical errors and manual Sync.
- Native 0.9.4 clean build: 165 tests passed, one optional sample skipped; lint zero errors. Same fleet certificate; non-debuggable, non-test-only APK. Actual APK installation and preserved Device Owner verified on the pilot.
- Original recovery tool: 17 offline tests passed. Delta recovery tool: 22 offline tests passed. Catalog publisher: 17 offline tests passed, including scope/drift/hash/preservation checks. Paused release publisher: 28 offline tests passed, including Windows-to-Linux SFTP path handling and redacted error diagnostics.
- Enrollment kit: 20 checks plus cloud enrollment checks passed. Physical fresh enrollment remains unverified.
- Live folder uploader: deliberately invalid split set and split-dependent base were rejected; no test catalog rows published. Temporary QA account and unreferenced test uploads were removed.
- Promoted dashboard: `dpl_51vGWJHNTTs27prvpr5uX1gHeT99`, source `4278100` plus the existing login-error patch retained unchanged. Hosted UI `25149460`: signature, tamper rejection, wrong signer rejection and source parity passed.
- Continuation verification: a certificate-verified HTTPS fetch from the school server returned HTTP 200 and UI envelope SHA-256 `39cbaed63c314026331f07fdd16f4cc2c02a154614ca05bf9812b4d24156bc20`, exactly matching the locally signature/source-verified deployment receipt. Local PC Node/curl certificate-chain/revocation checks failed; TLS validation was not disabled to work around them.
- Login overlay files remain uncommitted in the user's workspace. Their SHA-256 values are `e64aa17a05aeaf9708e4a8b020ebc7d055810fe92643e56d6dfbc63d3311acb5` (`actions.ts`), `ef00874613544d6b0eb9e5d2f155735e04ec21037083ff4f474743311e8e4f66` (`sign-in-error.ts`) and `4bce655db88717dfb80d96f7d587fb01e0ccf20303a12f772e3a8ace5af02eaf` (test). Four login tests, generated route types, TypeScript and the production build passed with the overlay.

## Artifacts

- `Desktop/Prime Secure/PrimeSecure-0.9.4-37.apk`: SHA-256 `9e4ac2da321d5bae3fc7bdb7bdbc58302122c83169754b0e0aafbd762135339b`, source `d3853b790e442f62d50b6a76e07bb860e55e0bb4`.
- `Desktop/Prime Secure/PrimeSecure-PC-Setup-0.9.4-StudentEnrollment-Compact.zip`.
- Version 37 is also published to private agent storage as an **inactive** release. Its bytes were SHA-verified; existing release rows and active flags were unchanged, with no device commands issued. Private transaction backup: `/root/primesecure-release-stage/backup-20261019T111636Z-9d40fc066af4446c80cb9b94ff215f43`. Publication initially exposed a Windows SFTP path-separator bug; corrected POSIX paths and server-side verification resolved it without activating a fleet update.
- Local verification receipts and screenshots are under ignored `artifacts/`. Build receipts do not substitute for physical behavior checks.
