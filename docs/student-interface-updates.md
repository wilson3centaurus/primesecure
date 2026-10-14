# Student interface delivery

PrimeSecure retains a native device-owner shell and a signed HTML/CSS/JavaScript workspace. A PWA alone cannot replace its Android management controls. Starting with 0.5.0, enrolled devices fetch the interface independently of APK releases.

## Normal workflow

Edit `agent/app/src/main/assets/student/`, test the student workspace, commit and deploy the dashboard to production. Its `prebuild` signs the current workspace using the private `PRIMESECURE_UI_SIGNING_PEM` production secret. The public release is `/student-ui/release.json`; it contains presentation assets only, with no student data or server keys.

The background hub sync checks at most hourly. A downloaded interface activates on the next app opening, so editing a profile or reading a book is never interrupted. Offline devices retain their saved interface and fetch changes after reconnecting. Preview and local dashboard builds retain the checked-in bundle and do not sign a fleet release.

Devices verify RSA/SHA-256 against the pinned public key, bridge compatibility, increasing version and a fixed file inventory. Assets load from an intercepted local HTTPS origin. All other requests and navigation are blocked; the workspace cannot browse remote sites with the native bridge attached. Local files are verified again before loading. A failed readiness handshake falls back to a previous working interface or the bundled workspace. Only recent working interfaces are retained.

To roll back content, restore the earlier source and deploy it as a new release. An older deployment URL alone does not override a newer interface already accepted by devices. Native bridge changes require a new APK and a compatible bridge version in the publisher and verifier.

## APK changes

Android controls, permissions and native PDF/media viewers still require APK updates. Validate one Primebook first. Use the Agent updates page to distribute production APKs centrally, signed with the same permanent key as the installed agent. The current test-only debug builds still need `adb install --no-streaming -r -t`; do not uninstall them or clear their data. Moving to a production build must account for losing the debug-only option to remove Device Owner without a reset.

For a 300-device rollout, test on one or a few devices before broad publishing; this interface channel currently targets all devices that have the compatible shell. School-specific or percentage rollout gates are not implemented.

## Keys and checks

The UI public key is checked in at `agent/app/src/main/assets/ui-public-key.txt`. The private backup lives outside the repository at `~/.ssh/primesecure-ui-signing.pem`, protected by Windows ACLs. Back it up securely; replacing it requires an APK trust-key update. The production Vercel secret is private and is not prefixed `NEXT_PUBLIC_`.

Manual signing: `node scripts/publish-student-ui.mjs VERSION`. Verification: `node scripts/verify-student-ui.mjs`, or pass the production release HTTPS URL to verify the deployed assets and reject changed bytes or a different signer.

Native activation and rollback still need a physical Primebook test; browser and build checks cannot establish that proof.
