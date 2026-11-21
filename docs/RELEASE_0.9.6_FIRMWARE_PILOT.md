# PrimeSecure 0.9.6 firmware pilot

Status: built and statically verified on 2026-10-29; not yet physically flashed.

- Version code `39`, same pilot APK certificate as 0.9.5.
- Adds the temporary reset-time HOME/setup gate used by the RoboKorda PrimeOS image.
- Keeps Wi-Fi selection reachable during enrollment and displays the hardware Wi-Fi Prime ID after Device Owner activation.
- Prepares Android's per-device password recovery token automatically during clean enrollment and registers before-first-unlock recovery when the token is immediately active.
- Does not add a universal password, hidden shared account, or plaintext password storage.
- Uses the existing RoboKorda-hosted MDM endpoint at `api.robokorda.duckdns.org`.

Artifact: `artifacts/release-0.9.6/PrimeSecure-0.9.6.apk`

SHA-256: `9C9DDDCE61D790B28B63E99799A7E88BF3E8C1F8F8A9DC889A0BB6CDED83B9B3`

Verification completed:

- debug unit tests and debug assembly;
- release assembly and release lint;
- APK signature verification and certificate continuity with 0.9.5;
- `testOnly=false`, version name/code inspection;
- byte-for-byte readback after embedding in the patched EXT4 system image.

Physical checks still required:

- boot animation and normal desktop transition;
- factory-reset setup gate and Wi-Fi selection;
- Android Device Owner provisioning on the clean device;
- automatic recovery status and a real temporary-password reset;
- PrimeSecure desktop icon and uninstall protection.
