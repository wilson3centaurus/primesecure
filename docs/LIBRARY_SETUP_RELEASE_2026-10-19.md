# Library and student workspace release - 19 October 2026

This is a coordinated dashboard, database, and Android change. A dashboard build
alone does not install native features on a Primebook. Record deployment and
physical-pilot evidence separately before a fleet rollout.

## Verified release evidence

- Implementation commit: `516db24cba2f173274157953868a727e0814c0ea`.
- Production dashboard: `https://primesecure-beta.vercel.app`, deployment
  `dpl_4oYhHH4UJyoAq3aK2d4SC4ehFkJb`, **READY**, Next.js 16.4.0;
  remote build completed in 20 seconds. Domain promotion verified.
- Four new migrations applied transactionally. Schema backup:
  `/root/primesecure-backups/library-release-20261018T234623Z` (UTC filename).
  No database, authentication, storage, or host restart was performed.
- Live import verified: 2,116 files; 22 folder records including the retained
  parent; 769,668,797 bytes. Every stored object was size/SHA-256 verified before
  publication. Eight previous catalog resources were replaced; their objects
  remain private for recovery, with catalog backup
  `/root/primesecure-backups/explore-20261018T234540Z.json` (UTC filename).
- Live checks: four new RLS-protected tables, anonymous reads/RPC denial,
  private 500 MB original-file bucket, active owner-only retention cron every
  15 minutes, and successful first cleanup invocation.
- Student interface 25141498: hosted signature, tamper/wrong-signer rejection
  and source parity passed. This is UI evidence, not native device proof.
- Tests: 62 dashboard, 38 database, 13 workspace tests; release compilation,
  lint and 94 native unit tests passed. Real Edge browser smoke passed for
  hearts, pinning, all three streams and Media controls with no page errors.
- APK: `C:\Users\XO\Desktop\Prime Secure\PrimeSecure-0.9.0-33.apk`, 2,971,909
  bytes, install code 33, same fleet certificate, non-test-only/non-debuggable.
  SHA-256: `663f4e5560a1631468eb575553458f2ec8f59e0b9ebf83222f6f22149d12b336`.
  Frozen native source is commit 516db24. No native fleet release was activated.
- Production login returned HTTP 200; unauthenticated publication redirected to
  login. The fresh deployment error query returned no logs; this is limited
  traffic evidence, not continuous monitoring or an authenticated end-to-end
  upload/capture test. Drains and long-term monitoring were not verified.
- Physical three-Primebook pilot remains outstanding. The user requested the
  APK for manual testing and will decide whether to roll out afterwards.

## Requested scope and safeguards

- Replace only Rusununguko ZIMFEP High School's **Explore & grow** contents.
  Keep the parent. Preserve other notes, schools, apps, wallpapers and personal files.
- Import the exact local `C:\Users\XO\Desktop\Prime Secure\images` tree:
  2,116 files in 21 folders; 769,668,797 bytes. This includes its attribution file.
- Keep resources private. Stage immutable uploads, verify every stored object's
  SHA-256 and size, save the previous catalog, and replace the scoped tree in one
  transaction. Cancel if staff changed its catalog after the backup.
- Keep previous objects for recovery; they are no longer offered by the replaced
  catalog. The local source folder is never moved or deleted.

## Library administration

- 500,000,000-byte ceiling for APKs, school resources and uploaded school media;
  100 files per ordinary selection. Existing 8 MB wallpaper safeguard remains.
- Folder picker retains names and nesting in the existing three-level hierarchy.
  Too-deep paths are rejected, not flattened. Large folders queue in batches of
  100. Empty folders cannot be enumerated by the browser directory picker.
- Uploads retain their original school and owner across dashboard navigation.
  Renew expiring sessions before upload/publication, retry expiry errors safely,
  and reuse already-uploaded objects after a lost response.
- Confirmed single/multiple recursive folder deletion removes only authorized
  resource trees, then cleans their unreferenced objects. Report storage cleanup
  failures honestly; never delete a blob after a rejected catalog operation.
- Read all catalog API pages instead of silently stopping at the server row cap.

## Native/student scope

Favorites, pinned entries, current wallpaper, automatic download ordering and
device-reported setup progress require the corresponding native version. Search
must operate on the entire permitted catalog, including files not saved offline.
Downloaded school content is not a substitute for an actual physical pilot.

Setup timing must state its observation boundary and whether offline/queue time
is included. Never infer transfer completion from a bounded task-history list.

## Monitoring boundaries

The school confirmed visible authorized controls and up to five incident frames
with seven-day retention. This does not authorize covert collection or override
Android camera, screen-capture consent, or protected-screen behavior.

Aggregate usage reports cannot reconstruct screenshots from earlier activity.
Live streaming and automatic incident evidence must not be described as working
unless the complete authorized capture/session/storage/retention flow is tested.

A concealed shared consumer Google account/password is not implemented. Supported
Google-account enrollment depends on Android Enterprise/EMM integration and exact
Primebook firmware Google-service support, not a dashboard password field.

## Release gates

1. Run upload, folder, publication, permission, capture, media-transfer and setup
   regression tests. Test actual generated import SQL and rollback/isolation.
2. Verify the intended backend; schema-only backup; apply reviewed additive
   migrations transactionally. No database/auth/server restart is needed.
3. Stage a clean production dashboard build; smoke-test; promote the tested build.
4. Sign/verify the student UI; build/test an APK with the same fleet certificate
   and a greater install code. Never uninstall or clear enrolled device data.
5. Update only the selected pilot before fleet activation. Check Favorites across
   restart, real file/cover opening, download stream order, admin progress,
   current wallpaper, consent/cancel/expiry and alarm stop/volume restoration.
