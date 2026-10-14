# PrimeSecure 0.4: offline workspace

The student workspace is bundled in the APK. The app caches the approved catalog and icons, messages, support chat, notes and full-resolution wallpapers. School downloads resume from partial files. A downloaded wallpaper applies locally; its preference syncs separately. A wallpaper that has not downloaded yet queues a download.

Background tasks shows connection waits, download bytes, speed, installation and completion. App cards show their own progress. Profiles, replies, support messages, name appeals and app requests save to a durable outbox. Installs re-check current school approval when connected. Request IDs deduplicate server actions after lost responses. Local profile drafts remain until confirmed by a fresh server snapshot.

Wi-Fi reconnects trigger check-in and pending work. The foreground management service catches up every minute and schedules inventory/location every five minutes. WorkManager retains its periodic fallback. Android and PrimeOS still govern actual scheduling and connectivity.

Students can edit username, DOB, address, guardian/student phones and a compressed picture. Real names remain school-controlled; correction requests appear in Student support. Picture selection is prompted on first open but optional. Profile entry also works offline. Support conversations are private to the student's device and school/support administrators.

Media defaults to Documents, filtering out APKs and dotfiles. Built-in viewers cover images, music, video and PDF. DOCX, ODT and EPUB offer bounded text views; formatting, embedded images and EPUB chapter order can differ. Legacy DOC and unsupported media codecs still need an approved reader. Storage totals come from Android; category totals are a partial shared-file inventory, excluding protected app/system files.

## Password recovery

1. On an unlocked Primebook, open About Device and choose Enable / confirm recovery.
2. Confirm the existing password when Android asks, then connect once.
3. Check the dashboard for Recovery: Ready and Before-first-unlock recovery: Registered.
4. An administrator can queue a temporary password for 30 minutes. Wait for a successful result before using it.

Student everyday device passwords are not collected. Android's escrow token stays local. Its boot copy is AES-GCM encrypted with Android Keystore in device-protected storage. The server stores a hash of a separate random capability that can fetch/ack already-authorized recovery commands only. That capability cannot create a reset or read student records. Temporary passwords are hidden from teachers and removed on acknowledgement, cancellation, or expiry during boot polling.

A Direct Boot service attempts authorized recovery before first unlock after reboot. Actual PrimeOS escrow, pre-unlock Keystore access, saved Wi-Fi connection and boot-service behavior require a hardware test. Test with a known password before relying on this for a forgotten one. This flow does not factory-reset or erase files. A separate Android user cannot automatically unlock another user's encrypted data.

The managed school lock screen has Check for unlock and Message RoboKorda support buttons. The Android password screen keeps its own controls; supported device-owner contact text is added.

## USB, Wi-Fi and location limits

USB restrictions persist and reapply from cached policy. Diagnostics show the requested block, restriction state and mounted drives. A set restriction does not prove PrimeOS blocked already-mounted media or access from another app. PrimeSecure refuses blocked USB volumes itself. Android 11 has no universal public API to forcibly unmount arbitrary drives or disable every USB port; physical enforcement needs a vendor/device test.

Keep Wi-Fi enabled restores the radio and holds a connection lock while management runs. Admins can turn this off. Firmware, sleep and the access point can still interrupt the link; holding the lock may increase battery use.

Location tries GPS first and rejects mock/stale fixes. Last-known fixes must be within two minutes. Network/fused/IP results are labelled unverified estimates. A microG provider returning another city needs provider repair or an independently configured location service; the agent cannot create a missing GNSS fix.

## Rollout

Apply the offline workspace, recovery visibility and boot recovery migrations. Existing enrollments and records are preserved. Update using the same-signature debug APK:

```sh
adb install --no-streaming -r -t /sdcard/Download/PrimeSecure-0.4.0-debug.apk
```

Do not uninstall or clear data. First let wallpapers and notes download, disconnect Wi-Fi, apply a saved wallpaper, edit a profile and queue an install/support message. Reconnect, then check task completion and the admin inbox. Test USB blocking and password recovery separately on one device.
