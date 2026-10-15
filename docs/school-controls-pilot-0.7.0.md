# School controls pilot: 0.7.0

Agent version **0.7.0**, version code **15**, uses the existing signing certificate and is neither test-only nor debuggable. The locally verified APK is `artifacts/primesecure-0.7.0-15.apk`, SHA-256 `9b85111b71b8cde60a227757c68b030c1350b94e8cd361eef83aa72b8a207bf1`. Its native source commit is `5de632a007795ddd47c9e5667270d70728428aae`.

## Available now

- **Apps → App Store:** fourteen reviewed optional apps: calculator, notes, calendar, Secure PDF Viewer and ten SECUSO logic/educational games. APK signatures, ZIP integrity and uploaded hashes were verified; corresponding source archives are hosted alongside the catalogue. Nothing was automatically installed. Each school controls shared-library access.
- **Settings → Device controls:** separate physical USB/SD mounting, USB computer transfer, outgoing Bluetooth sharing, full Bluetooth blocking, new users/guests, user switching, Settings factory reset and opt-in usage summaries. New controls default off; existing school policy is retained.
- **Apps → App rules:** named built-in app requests. Protected firmware requests are visibly reported as not enforced. They do not override the PrimeOS boot/login safety exclusions.
- **Students & devices:** photo preview/enlargement, separate student number and hardware Prime ID, class details, Wi-Fi observations and lost-device controls. The school-provided verified Prime ID for Princess KC is `78:C8:24:B5:8E:12`.
- **Reports:** seven/thirty-day app rankings, screen, connection and observed uptime estimates with coverage and CSV export. **Cases:** unapproved-app evidence and staff-created investigations with notes/status; observing a case does not turn on covert capture or change enforcement.
- **Student app:** compact app icons, sticky header, optional-app uninstall queue, reporting explanation and explicit support-photo capture/review/send. Required apps and media viewers remain protected from uninstall.

## One-device test before a wider rollout

1. Publish the APK in **Agent updates** with code **15**, name **0.7.0**. Check the pilot device reports 0.7.0 and the current school sync revision. This upgrades an existing same-signer, non-test-only installation without reinstalling enrollment. Older test-only installations may still need their previously documented one-time ADB transition.
2. Install and open the four utility apps, then a selected game. Test keyboard/trackpad, offline use, external links and share/import buttons. Select Secure PDF Viewer for PDFs only after confirming it handles school documents correctly.
3. Enable physical-media blocking and test USB and SD independently after restart. Test Bluetooth outgoing sharing and, separately, full radio blocking. Full blocking also disables Bluetooth accessories. A reported restriction flag is not proof of physical enforcement.
4. Test prevention of new users, guest entry and user switching through PrimeOS's custom login. Existing accounts are retained. Restart and confirm normal student login before adding another restriction.
5. Enable usage summaries, explain the displayed disclosure and grant **Android Usage Access** from the student About Device screen. Confirm a report arrives after activity; uploads are batched approximately every fifteen minutes while the agent can run/connect. Missing coverage means unknown activity, not zero use.
6. On the pilot only, test **Mark lost** without an alarm first. Confirm the visible lock, recovery message, one-use online code and **Mark found**. Then test the alarm briefly. Network delivery, alarm volume/output and custom lock behavior need device verification; physical power controls remain available.
7. From student support, choose **Share photo**, take a test picture, inspect the preview, discard once, then explicitly send another. Confirm it arrives in Student support. This is a photo-sharing flow, not a live video/audio session.

## Boundaries and pending products

Normal location reads default to thirty minutes and lost mode requests two-minute attempts. Manual Locate now stays immediate. Android privacy notices remain enabled. SSID/BSSID and provider diagnostics carry observation times; none establishes an exact location by itself.

Reports collect app names/durations and aggregate service observations, not browsing history, typed text, screenshots, private messages or document contents. Unapproved-app cases cannot detect every website opened inside an otherwise allowed app. System apps remain protected; complete browser/terminal lockdown on this firmware is not claimed.

Settings reset restrictions do not prevent hardware recovery wipes or reflashing. A wiped user-installed agent cannot reinstall itself. See the [prepared manufacturer request](primebook-reset-integration-request.md); it has not been sent.

Word, Excel, Classroom, Gmail, ChatGPT, Minecraft Education and exam apps need the authorised publisher/account/licensing route described in the [app review](school-app-library.md). Microsoft Access has no Android edition. No unofficial mirrors, WPS, general browser, terminal or HTML/MHTML executor were added.

Automated validation covers 64 database tests, 28 native tests, dashboard lint/build, student UI bridge tests and isolated live browser/API flows. It does not replace the PrimeOS tests above.
