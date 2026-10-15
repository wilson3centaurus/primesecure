# Login-screen recovery: PrimeSecure 0.6.2

## Incident and immediate containment

One Primebook reported a flashing/unusable login screen after installing 0.6.1, applying strict app approval, and restarting. The precise crash and package dependency have not been confirmed from device logs. The 0.6.1 package protection excluded most manufacturer system apps; that is an unsafe assumption on PrimeOS.

Pause 0.6.0/0.6.1 under Agent updates. Pausing stops further offers; it does not roll back an installed APK or undo its restrictions. Disable **Apps > App rules > Allow only school-approved apps**, then save. An agent still performing normal authenticated check-ins can release its previous strict restrictions. If an older manual allow-list or explicit hidden list exists, it remains separate; remove those restrictions for recovery too. The existing pre-unlock channel only accepts password resets, not normal policies or APK installation.

Do not factory reset, uninstall, clear app data, flash the device, or issue Retire as a troubleshooting step. These discard state or enrollment. A lower-version paused release is not an APK downgrade.

## Recovery APK

`artifacts/primesecure-0.6.2-8.apk` is version code 8, signed with the same local key as 0.6.1, non-test-only and non-debuggable. It preserves the 0.6.0 changes. When installed, its boot-aware receiver attempts to restore hidden/suspended essential apps locally, without using credential-encrypted agent preferences or requiring internet access.

If normal check-in works, upload it under Agent updates. Publishing currently offers it to all eligible enrolled devices. Otherwise, an already authorized adb connection can update it in place, including before unlock if Android permits the install:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices -l
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install --no-streaming -r "C:\Users\XO\Desktop\primesecure\artifacts\primesecure-0.6.2-8.apk"
```

Capture logcat first if possible; keep it private because device logs may include student information. If adb says unauthorized or lists no device, this route is not yet available. The USB cable must support data, and the device must already trust this PC or be able to approve its debugging prompt. Do not promise remote recovery solely from an Online badge: check the actual last-check-in timestamp and whether it advances.

## Safety changes and limits

- Every system or updated-system package is protected from hiding/suspension, including Settings and the vendor store. Ordinary third-party apps still follow the approved catalogue.
- All discoverable home apps and input methods, the active WebView, known platform components, PrimeSecure and active device administrators are protected too.
- Boot/update repair intentionally restores hidden/suspended protected packages. This may reveal a preloaded system app hidden previously; boot and login stability take precedence over icon removal.
- Normal startup and policy application use the same protected set. A strict policy cannot immediately hide restored essentials again.
- Pre-unlock repair runs off the UI thread and does not access enrollment credentials or change the student's password.

Unit tests cover strict/empty catalogues, explicit blocks, previously hidden login dependencies and releasing restrictions when strict mode is disabled. A signed APK, passing build/lint and unit tests do not establish physical PrimeOS recovery; verify login, restart and app restrictions on the affected Primebook before any larger rollout.
