# PrimeSecure 0.6.3: reinstall after factory reset

The affected device last reported 0.6.1. The user factory-reset it after its login screen became unusable after a restart. The screenshot shows 0.6.2 was published but the device still reported 0.6.1, so there is no evidence it installed the recovery build. No crash logs from that incident have been recovered. Treat firmware dependency hiding as a likely cause, not a proven crash diagnosis.

## Changes retained and added

0.6.2 protects all firmware/updated-firmware packages, all discoverable launchers and input methods, active WebView, known core components and active device admins. It repairs essential hidden/suspended state before first unlock or on update, without depending on enrollment credentials or the network. Settings and vendor system apps remain visible for safety.

0.6.3 additionally serializes cached and fresh policy applications. The boot path loads saved policy only after acquiring that same queue, so it cannot keep an obsolete snapshot while waiting behind a fresh policy. Complete check-ins are serialized too, so periodic, reconnect and manual check-ins cannot overwrite each other out of response order. Restriction intent is committed before hiding or suspending apps, and resulting hidden/suspended sets are committed together. Failed restoration remains tracked for retry rather than silently losing its recovery record. These are confirmed code weaknesses; their contribution to this specific login failure is unproven.

## Install and test

Use `artifacts/primesecure-0.6.3-9.apk`, version code 9, signed with the same certificate as prior enrolled builds. Release builds are non-test-only and non-debuggable. They can be installed by tapping the APK when Android allows that installation source. Device-owner provisioning is still a separate setup step; tapping Install alone does not create an enrolled managed device.

Keep **Apps > App rules > Allow only school-approved apps** disabled during the first enrollment and restart test. From the existing student's device page issue a new enrollment token rather than adding a duplicate student. Provision the device owner using the established on-device Termux/wireless-adb method, then enroll with that token. Avoid adding personal accounts before device-owner provisioning.

First test a normal restart and login with strict rules disabled. After that succeeds, enable strict rules on this single test Primebook, check the reported policy, and repeat the restart/login test. Do not infer physical PrimeOS boot safety from passing unit tests or a signed APK alone. Keep any on-device terminal approved while testing so diagnostics remain accessible.

## Restart, reset and persistence

- A normal restart retains the app, enrollment and device-owner state. Cached policy survives offline. The normal management service starts after first unlock; only the dedicated safety/recovery components are available beforehand.
- A factory reset removes the user-installed APK, app data and local enrollment/device-owner state. The server's old Active record is historical; it cannot restore software by itself. Reinstall and re-provision are currently required.
- PrimeSecure does not currently apply `DISALLOW_FACTORY_RESET`. Android provides that restriction for the reset option in Settings, not a general guarantee against recovery-button wipes or firmware flashing.
- Automatic enrollment following a factory reset requires a supported manufacturer/reseller provisioning path, such as Android Enterprise zero-touch on eligible devices, or Primebook firmware/setup integration. That has not been implemented or confirmed available on these Primebooks. Factory Reset Protection is a different activation-control feature and does not reinstall PrimeSecure.

References:
- https://developer.android.com/reference/android/os/UserManager#DISALLOW_FACTORY_RESET
- https://developers.google.com/zero-touch/guides/customer/how-it-works
