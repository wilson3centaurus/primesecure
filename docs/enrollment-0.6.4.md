# PrimeSecure 0.6.4: enrollment and first preparation

## Device Owner is an Android authorization step

The enrollment key identifies the school/device record. It does not grant Android Device Owner permission. Primebook's username/region/phone/OTP wizard is manufacturer setup; it must not be assumed to support Google's welcome-screen QR enrollment.

The APK now has **Set up device management**. On Android 11 or earlier it checks for Android's managed-device provisioning activity, whether Android permits provisioning, and whether system/user setup is already complete. Only an eligible unconfigured device can launch the Android authorization flow. It preserves system apps during provisioning. The user must explicitly confirm before starting because Android documents that failed managed-device provisioning can reset the device. This is never started automatically after entering a key.

When PrimeOS has already completed its setup, or the provisioning activity is absent, the button explains the limitation. It does not invoke `dpm` as an ordinary app, fake Device Owner with legacy admin activation, create a work profile instead, change setup-completed flags, or reset the Primebook. Authorized adb provisioning remains necessary unless Primebook provides a supported alternative. Android 12+ does not use the deprecated in-app managed-device intent in this implementation.

Successful Android provisioning forwards the enrollment key to PrimeSecure. The APK also declares support for a manufacturer-initiated Device Owner transfer and accepts its token bundle only after Android confirms PrimeSecure is Device Owner. Support for that callback does not authorize PrimeSecure to initiate a takeover of another owner's device.

## Resumable preparation

After a successful enrollment exchange, a per-enrollment setup checkpoint is saved before background workers start. PrimeSecure routes to **Preparing your Primebook**, including after reopening it or after a failed initial check-in. Existing enrolled devices upgrading from earlier APKs are not unexpectedly forced through first setup.

The screen checks actual state:

1. Android reports PrimeSecure as Device Owner.
2. A fresh school policy has been applied without reported errors.
3. The school catalogue and required-app queue have been received.
4. All apps marked preinstall, plus approved preferred media viewers, are installed.
5. The default school wallpaper has been applied and downloaded locally, when configured.
6. Up to three initial learning resources, with a combined limit of 25 MiB, have downloaded. Small files take priority; the rest of the notes library continues in the background.
7. Android's all-files/media access is enabled. An **Allow media access** button opens the system permission screen, replacing the appops command on firmware that supports the permission UI.

Real download/install statuses, percentages and network speeds appear when reported by the existing task engine. Offline setup says it is waiting, retains its checkpoints and resumes through existing workers. Retry requeues failed app installs and schedules policy/content work. Errors are shown; no timer or arbitrary percentage declares a device ready. The student opens the workspace once all required checks pass, then completes the existing student-profile flow.

Preparation keeps the screen awake only while that activity is visible. It does not enter lock-task mode, start over the Android keyguard, replace the launcher or suppress the Home key. Leaving and reopening PrimeSecure returns to unfinished setup. The 0.6.3 system-app safety and policy-serialization fixes remain in place.

## For the current Primebook

Install `artifacts/primesecure-0.6.4-10.apk` (non-test-only, same signer, version code 10). If the management setup button reports that PrimeOS setup is complete, use the established authorized on-device adb method once:

```sh
adb shell dpm set-device-owner com.robokorda.primesecure/.AdminReceiver
```

No app-install `-t` flag is needed for this release. Open PrimeSecure, enter the token issued for the existing student record, and allow the media-access permission through the new screen. Keep the internet connected while required apps/wallpaper/initial notes finish. Test a restart on this one Primebook before broader use. Android provisioning, ownership transfer, permission UI and install progress remain physical-device tests.

For 300+ devices, the scalable route is integration with Primebook's authorized setup/management system, not assuming an arbitrary installed APK can assign itself ownership. See `primebook-provisioning-integration.md` for a request you can give the manufacturer. No request has been sent on your behalf.

References:
- https://developer.android.com/reference/android/app/admin/DevicePolicyManager#ACTION_PROVISION_MANAGED_DEVICE
- https://developer.android.com/reference/android/app/admin/DevicePolicyManager#transferOwnership(android.content.ComponentName,android.content.ComponentName,android.os.PersistableBundle)
