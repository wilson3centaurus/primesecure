# School app library review

Reviewed 15 October 2026 for Android 11 Primebooks. This is a free-first collection with licensed products listed separately. Downloads are candidates for a one-device pilot; none of these checks is proof that an app has no escape path or that it works correctly on PrimeOS.

## Prepared APKs

The APKs and machine-readable import metadata are in the ignored local directory `artifacts/school-apps/`. `school-app-import.json` records each package, actual manifest version, size, SHA-256, signing certificate, official release/download URL, source URL, permissions and icon. It sets `preinstall: false` and `fleet_tested: false`.

All 16 downloaded APKs passed Android SDK signature verification and ZIP CRC verification. Fifteen have no Android Internet permission. All ten SECUSO games match the signing certificate [published by KIT SECUSO](https://secuso.aifb.kit.edu/english/105.php): `466d66dc058f73043e5e9bdd5606fdaec19d8f80c47f44c1807d65775d735c3f`. Fourteen downloads also match a publisher-provided SHA-256; Solitaire and Reckoning Skills have no GitHub asset digest, so their local hashes and the independently published SECUSO certificate are recorded instead.

Icons come from the same pinned official source tag. The dashboard's current raster icon extractor cannot resolve these APKs' obfuscated adaptive-vector icons. The original APKs remain unmodified. Exact source archives, including license notices, are staged in `sources/`; keep the relevant source and notices available alongside GPL app distribution. Use one signing lineage for future updates.

| App | Version | Approximate download | Internet permission | Initial use |
| --- | --- | --- | --- | --- |
| Fossify Calculator | 1.4.0 | 7.0 MB | No | Arithmetic, scientific functions and conversions |
| Fossify Notes | 1.7.0 | 9.5 MB | No | Personal notes and checklists |
| Fossify Calendar | 1.12.0 | 8.2 MB | No | Local timetable and reminders |
| Secure PDF Viewer | 33 | 4.8 MB | No | Focused PDF viewer candidate |
| Fossify Music Player | 1.8.4 | 11.1 MB | No | Optional local audio player |
| Sudoku | 3.2.6 | 5.2 MB | No | Number and logic puzzles |
| 2048 | 1.4.2 | 9.3 MB | No | Number patterns and planning |
| Minesweeper | 1.2.3 | 6.2 MB | No | Deduction and probability |
| Memory | 1.1.3 | 8.6 MB | No | Visual recall and matching |
| Battleships | 2.0.0 | 5.8 MB | No | Coordinates and deduction |
| Solitaire | 1.1 | 6.0 MB | No | Planning and sequencing |
| Ludo | 2.3.3 | 7.6 MB | No | Turn-taking and probability |
| Reckoning Skills | 1.1.1 | 4.5 MB | No | Mental arithmetic |
| Checkers | 1.3.4 | 6.5 MB | No | Board strategy |
| Dice Game | 1.1.7 | 5.0 MB | No | Arithmetic and probability; school reviews suitability |
| GCompris | 26.2 | 99.0 MB | Yes | Separate optional activity-suite review |

The ten games are available equally to all students. Teachers can choose which suit a class; they are not divided by gender. They are from [SECUSO's developer releases](https://github.com/SecUSo), rather than ad-supported clones. Every APK except the optional GCompris build has minSdk 26 or lower; GCompris requires API 28. Universal APKs cover common ARM and x86 variants; the downloaded GCompris APK is ARM64 only.

Two upstream filenames are misleading: the Ludo release is named `pfa-pausing-healthily-release-v2.3.3.apk`, while its verified package is `org.secuso.privacyfriendlyludo`; Memory's filename says 1.3.3, but the verified manifest version is 1.1.3. Import metadata uses the manifest identity, not filenames. Reckoning Skills' published package also has the upstream spelling `org.secuso.privacyfriendlyrecknoningskills`.

## Default media viewers

Keep PrimeSecure's own viewers as the narrow starting point for images and video. They avoid adding another broad media library. The external PDF candidate is [GrapheneOS Secure PDF Viewer](https://github.com/GrapheneOS/PdfViewer/releases/tag/33), package `app.grapheneos.pdfviewer`. The inspected APK handles `application/pdf`, has no network or shared-storage permission, and receives a document through Android's content provider. Its controlled PDF renderer is not a general HTML/MHTML executor. This is the official developer-signed GitHub build; the Play version uses a different package ID and signing lineage. Test opening school PDFs and keyboard/navigation on the actual Primebook before selecting it as a preferred viewer.

For audio, [Fossify Music Player](https://www.fossify.org/apps/music-player/) is a narrower candidate than VLC: its inspected content/file handlers are audio types, and it has no Internet permission. It still lists local audio by album, artist and folder, and has share/import surfaces. It must remain optional if the school requires every file to be chosen only inside PrimeSecure.

Do not set VLC as the restricted default. [VideoLAN documents network streams, media-library browsing and NAS/shared-drive browsing](https://images.videolan.org/vlc/download-android.html). It is a good general player but exposes more than this school's requested single-purpose flow.

These apps do not decide whether an image, song or PDF is appropriate. Removing browser apps does not remove all network-capable WebViews in other apps. Blocking USB/SD/Bluetooth transfer, restricting file imports and sharing, and controlling network access are separate controls. An app with no Internet permission may still ask another installed app to open a link; keep browser/HTML-handler policy enforced and test external-link buttons.

## Office, Google services and paid products

No unofficial APK mirror, paid-app copy, Play extraction or unverified download has been added. An official store listing is not permission to rehost that APK on PrimeSecure's server.

| Requested product | Official route | School decision / deployment limit |
| --- | --- | --- |
| Microsoft Word | [Microsoft's Android installation guidance](https://support.microsoft.com/en-au/word/download-office-apps-for-android-from-google-play), [official app](https://play.google.com/store/apps/details?id=com.microsoft.office.word) | Obtain an authorized deployment route and qualifying school licenses. A large-screen Primebook may require a paid subscription for editing. |
| Microsoft Excel | [Official app](https://play.google.com/store/apps/details?id=com.microsoft.office.excel) | Same licensing/deployment review as Word; test spreadsheet editing, storage pickers and links. |
| Microsoft Access | [Microsoft product page](https://www.microsoft.com/en-us/microsoft-365/access) | PC-only. There is no native Microsoft Access Android APK to upload. A Windows lab or controlled remote Windows session would be a separate project. |
| Google Classroom | [Google's official app](https://play.google.com/store/apps/details?id=com.google.android.apps.classroom) | Use school-managed accounts. Assignments support attachments and student interaction, so this is not an isolated offline reader. |
| Gmail | [Google's official app](https://play.google.com/store/apps/details?id=com.google.android.gm) | Configure school-domain communication rules and managed accounts; mail and attachments are another content-transfer route. |
| ChatGPT | [Official OpenAI app listing](https://play.google.com/store/apps/details?id=com.openai.chatgpt) | Separate approved online research tool. No direct redistribution APK was obtained; do not replace it with an unrestricted custom web wrapper. |
| Minecraft Education | [Official IT administrator/licensing route](https://education.minecraft.net/en-us/get-started/it-admins), [Android availability](https://education.minecraft.net/en-us/mobile) | Obtain assigned education licenses and test device support. Internet, multiplayer and coding features require a separate school policy review. No paid copy was downloaded. |
| Magic Tiles | [Official Amanotes portfolio](https://products.amanotes.com/) | Not included in the restricted starter set. Review the exact game, commercial terms, content and online surfaces before purchasing or authorizing deployment. |

Microsoft's [current mobile entitlement table](https://support.microsoft.com/en-us/microsoft-365-activation-licensing/mobile/what-you-can-do-in-the-microsoft-365-apps-on-mobile-devices-with-a-microsoft-365-subscription) lists Office 365 A1 and Microsoft 365 A1 with a 10.9-inch editing limit. Other plans and app features differ; confirm the exact Android application, assigned student licence and screen size before promising editing. Schools can [verify academic eligibility](https://learn.microsoft.com/en-us/microsoft-365/commerce/subscriptions/verify-academic-eligibility?view=o365-worldwide) and use [Microsoft Education's licensing contact route](https://info.microsoft.com/ww-landing-contact-me-page.html?lcid=en-us). No license purchase or subscription was started.

[Managed Google Play](https://support.google.com/work/android/answer/7042221?hl=en) is an official way to curate and deliver public apps, but it requires organization registration, accounts and EMM integration. PrimeSecure's APK library currently is not a managed Google Play integration. PrimeOS Google certification/services and OEM support must also be checked. Where that route is unavailable, request an enterprise redistribution package and terms directly from the publisher; copying a Play APK is not a substitute.

### Confirmed school setup, 15 October 2026

The administrator confirms student **A1** licences and managed Google Workspace accounts. The Primebooks have **only the Primebook App Store**, with no Google Play Store. This confirms account availability, not compatible app delivery or editing entitlement.

[Primebook's WiFi specifications](https://www.primebook.in/bulk-order) list an 11.6-inch screen. That exceeds the A1 limit in Microsoft's mobile table, so Word/Excel editing must remain unverified pending a publisher/reseller entitlement check and one-device test. [Office 365 A1 includes web-based Word and Excel](https://www.microsoft.com/en-us/education/products/office). A restricted online school portal is a possible separate pilot; it has not been enabled under the school's current no-browser policy.

Do not install Google Play services or a second management controller as an assumed fix. Google [no longer accepts new custom DPC registrations through the old Play EMM route](https://developer.android.com/work/dpc/build-dpc). The manufacturer request now asks for supported Google-app compatibility and authorised silent app delivery through PrimeStore/OEM integration or publisher-provided packages. Classroom/Gmail sign-in, assignments and notifications still need a device test after an authorised installation route is established. No Microsoft/Google app is claimed as downloaded or deployed by this update.

## Contained learning and research

No general browser, HTML/MHTML viewer, terminal, ADB utility, native code editor or WPS package is included.

- **Tinkercad:** use teacher-managed Classrooms and Safe Mode if a later approved-site feature is introduced. [Autodesk's own classroom guide](https://images.tinkercad.com/jl5ii4oqrdmc/1eTWASZYKjnMX9u5ioLh8Y/bb2dfb24cfc4bd66adc485baaecedf97/Tinkercad_Getting_Started_Guide_ISTE.pdf) describes limiting public sharing and gallery distractions. This is a website, not an official Android APK discovered for redistribution. A generic browser wrapper would reopen the current browsing problem.
- **Wokwi:** keep deferred until a supervised web/network policy is tested. Its [official documentation](https://docs.wokwi.com/) explicitly includes simulated Internet connectivity and HTTP/MQTT, so calling it a completely contained offline circuit toy would be incorrect.
- **Scratch:** use the [official download route](https://scratch.mit.edu/download) for a supervised offline block-programming pilot. No unofficial Android repack or arbitrary HTML executor has been added.
- **Visual Basic:** no supported Microsoft VB desktop editor/console for Android was identified. Do not relabel a terminal or generic code runner as a restricted VB tool.
- **Offline research:** teacher-selected PDF/EPUB resources in School Notes are the initial option. Kiwix and Kolibri can support later curated offline libraries, but the general Kiwix reader accepts imported archives and Kolibri adds its own learning platform; neither is silently enabled as a narrow research tool.

For videos, prefer school-owned/licensed files in School Notes. Google offers [YouTube Player for Education](https://support.google.com/youtube/answer/18481571?hl=en), an embedded teacher-assigned player with no browsing/recommendations. It is not a standalone "YouTube Education" APK and is available through participating platforms. [YouTube's school guidance](https://about.youtube/schooladministrators/) describes keeping normal YouTube blocked while teachers assign specific videos through supported education tools. PrimeSecure is not currently an authorized Player for Education integration; a homemade YouTube wrapper would not acquire those controls or rights.

## ZIMSEC, Unopasa and Bible resources

The verified Unopasa identity is [Unopasa: Exam Preparation by softlab](https://play.google.com/store/apps/details?id=com.edufree.zimsec), package `com.edufree.zimsec`, linked from [Unopasa's own website](https://www.unopasa.com/). Its listing includes ads; the [current privacy policy](https://www.unopasa.com/terms/privacy-policy) describes resource/search/download activity and account data. No developer-authorized redistribution APK was found. Keep it pending publisher distribution terms and an ad/link/import pilot; do not confuse the study app with an official ZIMSEC product.

[Age-X Zimsec Maths Revision](https://play.google.com/store/apps/details?id=agexdev.math) and [Zimsec English Revision](https://play.google.com/store/apps/details?id=agexdev.english&hl=en) are identified candidates. Maths explicitly says it is independent of ZIMSEC and the Ministry; English lists ads. No blanket approval of every app with "ZIMSEC" in its title is justified. Obtain the specific subject packages from an authorized source, review advertising/external links, and have teachers confirm syllabus accuracy and content rights before publication.

For Bible study, the narrowest initial option is an approved offline PDF in School Notes, rather than adding a general Bible app with catalogs, external resources and account sync. The [World English Bible publisher provides PDFs](https://ebible.org/pdf/engwebp/) and identifies the translation as public domain, subject to preserving its name correctly for unchanged text. Choose the school's preferred translation/edition first. A direct PDF download was attempted but the publisher endpoint failed TLS certificate verification in this environment; no certificate check was bypassed and no Bible file is claimed as downloaded. AndBible is a legitimate [open-source alternative](https://andbible.org/), but its module downloads, external resources and sync need separate review, so it is not in this starter import.

## Before enabling on more devices

Pilot the four core utilities and selected games on the existing test Primebook. Confirm signature-compatible installation, launch, keyboard/trackpad use, offline behavior, media handoff and uninstall policy. Check app help links, share/export/import buttons, account sign-in, Android document pickers and attempts to open blocked websites or executables. Keep required recovery/provisioning tools out of student access once an independently tested recovery route exists; do not hide OEM login dependencies to achieve a cleaner app drawer.

The APK checks establish origin, identity, integrity, permissions and declared file handlers. They do not prove exploit resistance, age suitability, curriculum approval, or physical-device enforcement. Keep the exact version and signing metadata when replacing an app, and repeat the relevant pilot when a new release changes its permissions or behavior.
