# PrimeSecure four-device pilot findings - 2026-10-27

## Outcome

The pilot found real usability and recovery gaps. Code changes below are implemented locally as agent `0.9.5` / version code `38`; they are **not deployed or physically verified on the four Primebooks yet**.

| Finding | Decision / local change | Remaining proof |
|---|---|---|
| Network lock can strand a device away from the lab Wi-Fi | Wi-Fi configuration is now always available. The existing network control restricts mobile-network configuration only. | Install 0.9.5 on one pilot device; enable the control; join a second school SSID and a home hotspot; reboot offline and repeat. |
| Google/YouTube reappear when offline | 0.9.5 includes Google and YouTube targets and reapplies the cached hide policy after offline restart, unlock, and the two-minute firmware-safety grace. | Confirm the pilot device is actually on 0.9.5, then test airplane/offline reboot. Record App visibility results. |
| Need uninstall instead of hide | Do not promise uninstall for read-only firmware apps. Device Owner can uninstall ordinary user-installed packages, but permanent removal of built-in Google/YouTube/vendor apps belongs in the custom OS product image. | Add a separately confirmed “uninstall user app” rule only after testing package/data removal and rollback. |
| Apps and 1.5 GB notes take too long | Required apps now download first, smallest first. Wallpapers, images, and notes continue later with existing resume support. | Measure install time and resumed downloads on the school connection. |
| “WhatsApp compression” requested | APKs are already ZIP-compressed and signed; recompressing/modifying them breaks their signature. Images, PDFs, audio, and video can be optimized before publication, but no existing 1.5 GB library object was changed in this work. | Inventory library MIME types and sizes; retain originals; pilot optimized copies and compare readability/quality. |
| Students may forget to enable password recovery | Enrollment now retries automatic recovery activation daily until Android reports `ready`. PrimeSecure already prevents its own password form from setting a password unless recovery is ready. | Enroll a clean device with no credential, verify `ready`, set/forget a test password, and perform connected plus before-first-unlock reset tests. |
| Device is offline when a password is forgotten | A remote command cannot reach an offline device. Plaintext password storage is rejected. | Design an offline signed challenge-response recovery flow for the custom OS; the device verifies an admin signature without exposing the student's password. |
| Factory reset removes management | Standard app-installed Device Owner state and local recovery material are wiped. | Custom OS must preinstall PrimeSecure and provision it during Setup Wizard after every reset; test on a sacrificial device. Hardware recovery/reflash remains a separate boot-chain problem. |

## Password privacy boundary

Student passwords will not be stored or displayed in plaintext, including behind a Vercel or database secret. A server secret controls access but does not make plaintext credential collection safe. The supported model is reset authority, not password retrieval:

- Online: short-lived admin-issued temporary password via Android reset-token escrow.
- Offline future design: device nonce plus an admin-signed recovery response, verified locally by a pinned school public key.
- Factory reset: automatic re-enrollment by the custom OS, not recovery of the old password or old local data.

## Firmware conclusion

The supplied PrimeOS directory is a 72-file, 3,390,416,385-byte MediaTek flashing/build-output bundle. It is not a complete source checkout. `misc_info.txt` proves AVB is enabled and references missing OEM, boot, recovery, system, and vendor private keys. A separate audit workspace is available at `C:\Users\XO\Desktop\PrimeOS-RoboKorda`.

## Verification completed

- Android unit tests: 167 total, 166 passed, 1 skipped.
- Dashboard admin/config tests: 25 passed.
- Dashboard: Next.js production build and TypeScript completed.
- Firmware baseline: copied to the separate workspace; all 72 files are byte-identical by SHA-256.

## Known non-code blockers

- No Primebook is currently visible through ADB, so installed pilot versions and physical behavior were not checked.
- The dashboard uses Next.js 16.4.0, which its own build reports is affected by a known security advisory.
- Supabase warns that Node.js 20 and below will lose future support; Node 22+ should be scheduled separately.
