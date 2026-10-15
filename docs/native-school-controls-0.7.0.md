# Native school controls in 0.7.0

The existing PrimeOS firmware/login safety exclusions remain in force. A requested blocked package that is a firmware, launcher, input method, WebView or active-admin component stays protected. This release does not repeat the earlier attempt to hide every system application.

## Transfer and account controls

School management settings now apply Android Device Owner restrictions for:

- Physical removable media: `block_usb_storage` applies `DISALLOW_MOUNT_PHYSICAL_MEDIA`, covering USB drives and SD cards. The independent `block_usb_transfer` controls Android USB file transfer.
- Outgoing Bluetooth file sharing: `block_bluetooth_transfer` applies `DISALLOW_BLUETOOTH_SHARING`. It does **not** claim to block incoming transfers. Enable `block_bluetooth` to disable the radio and configuration instead; this also prevents Bluetooth mice, headphones and other Bluetooth accessories.
- User/guest creation: `block_add_users`. Existing secondary users are not deleted. On Android 9+, `block_user_switch` additionally requests that Android prevent switching users.
- Factory reset from Android Settings: `block_factory_reset`. It does not lock the bootloader, recovery menu, physical reset buttons or firmware flashing. An ordinary APK cannot install itself after an actual factory wipe; OEM provisioning integration is still required.

All new switches default off until the school chooses them. Runtime reports include the restriction flags Android accepted. A set flag is not proof that custom PrimeOS enforces every access path. Test USB and SD independently, and test guest/login behavior on one pilot device before fleet rollout. Existing mounted media may remain mounted; this app does not call hidden unmount/root APIs.

## Lost-device mode

The server's lost flag requests the existing visible Device Owner lock screen and an optional looping alarm. A received lock is applied before later library downloads, so a library failure does not delay an already received lock. Lost mode requests Wi-Fi stay enabled using the existing documented Device Owner/Wi-Fi lock path. Android/OEM power management can still stop connectivity, and the app cannot force a connection to an unknown Wi-Fi network or start while powered off.

The alarm uses Android's alarm audio stream at its existing volume and remains subject to device audio/output behavior. The physical power control and emergency OS behavior remain available. The native code does not disable the keyboard/touchpad, change the student's Android password, or create another Android account.

An administrator can clear lost mode online or provide the one-time 16-character recovery code. The student-facing recovery button verifies that code with `device_recover_lost`; it does not store a plaintext offline master password. Network access is required, and the app stays locked until a successful server check-in confirms the unlock.

No remote camera/microphone capture is implemented. Support has an explicit **Share photo** flow: the student opens the normal camera app, reviews the thumbnail, then chooses **Send photo**. A bounded JPEG waits in the private offline queue if necessary. There is no background recording or remote camera trigger.

## Location, Wi-Fi and Prime ID

Normal background location uses the school's `location_interval_minutes` (default 30; bounds 5–1440 minutes). Lost mode uses a two-minute attempt interval while the device can run and connect. Explicit **Locate now** remains immediate. Location-provider diagnostics and current SSID/BSSID reads are cached on the same cadence; a network change invalidates the Wi-Fi cache. Cached readings carry their observation time and should not be presented as a new fix.

Runtime permissions that are already granted are no longer repeatedly written during every heartbeat. Android location/admin privacy notices remain intact. These changes reduce location access frequency; they do not guarantee removal of a PrimeOS privacy notification.

Prime ID comes from Device Owner `getWifiMacAddress`, which is the Wi-Fi inventory hardware MAC. It is not the Android ID, student number, or randomized network address. Missing/placeholder values are reported as unavailable. Current connection details are SSID, BSSID, RSSI, frequency and link speed, with no network scan, saved password or nearby-network list.

## Usage reports

`usage_reporting` is school opt-in, off by default. The student About Device screen explains the report and exposes **Android Usage Access** settings; this special access cannot be silently granted as an ordinary runtime permission.

Daily reports use UTC dates and contain app package/name/foreground duration (up to 100 apps), observed screen time, observed connected time and observed service uptime. App durations are built from Android foreground/background events. They can undercount activities spanning midnight and are marked partial if the 100,000-event/top-100 bounds are reached. Service observations have approximately 30-second resolution and deliberately exclude long gaps/reboots. They do not measure browsing activity, actual internet attention, keystrokes, message text or screen pixels.

Offline observed daily totals are bounded to seven days and uploaded when connected. The server performs authorization, scope checks and report aggregation. Turning the setting off stops collection and clears unsent native usage totals; existing server history follows server retention rules.

## Optional app removal

Student removal requests wait in Background tasks when offline. Before removal, the worker fetches a fresh authenticated school catalogue and verifies active device status, approved app identity, current required/default/viewer status and protected/system/self exclusions. Required/default/viewer packages have Device Owner uninstall protection; ordinary approved optional apps can be removed. The worker never trusts a WebView-provided package name.

## Android primary references

- [UserManager restrictions](https://developer.android.com/reference/android/os/UserManager)
- [Device Owner hardware Wi-Fi MAC](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#getWifiMacAddress(android.content.ComponentName))
- [UsageStatsManager and required access](https://developer.android.com/reference/android/app/usage/UsageStatsManager)
- [Basic camera intent capture](https://developer.android.com/media/camera/camera-deprecated/photobasics)

Unit tests cover location cadence and clock correction, placeholder MAC rejection, protected removal decisions, foreground interval accounting and sampling-gap exclusion. Physical PrimeOS enforcement, actual alarm output, camera intent behavior and usage-access availability still need testing on the school pilot device.
