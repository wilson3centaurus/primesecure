# Prime Media · 0.8.9 (26)

Students open **Prime Media** in PrimeSecure. Administrators use **Content & files → Prime Media**.

| Collection | Student action | School control |
|---|---|---|
| Approved YouTube videos | Search the collection; watch inside PrimeSecure | Add/remove video links and categorise them |
| YouTube search | Submit a search; select a school channel when configured | Explicit school opt-in; Strict SafeSearch; optional channel list |
| Uploaded audio/video | Queue a download, including offline; play the saved file | Upload MP3/M4A/OGG/WAV/MP4/WebM, max 250 MB; withdraw access |
| Downloaded | Play saved school files offline | Downloads are on demand, not automatically pushed to every device |

The general browser remains blocked. The YouTube player is separate from the
student workspace and has no school JavaScript bridge. External links, popups,
file access, uploads, camera/microphone permissions and player downloads are
disabled. A different video must be selected through Prime Media. Do not treat
SafeSearch or the embedded player as a guarantee that every result is suitable.
YouTube can show ads and some videos cannot play embedded or on a given WebView.
Downloads are school-hosted files only; YouTube media is not converted or saved.

## Setup

1. Set `YOUTUBE_API_KEY` in the Vercel PrimeSecure project's Production environment.
   Restrict it to YouTube Data API v3; never prefix it `NEXT_PUBLIC_` or put it in the APK.
2. Redeploy. The admin page reports whether the key is configured.
3. Enable YouTube search in the school's media controls. Optionally enter channel IDs:
   `UC… | Channel name`, one per line (max 20). An empty list permits global YouTube search.
4. Add approved videos and/or upload files. Shared files are opt-in per school.
5. Install 0.8.9 on one pilot device via Recovery & rollback. Test playback, offline
   download queue, background progress, reopening saved media and policy withdrawal.

Search uses the official Data API through a device-authenticated server endpoint.
An atomic per-school limit of 80 upstream searches/day protects the initial quota;
repeated identical device searches are cached for five minutes. Results stay in
memory; they are not stored as student search histories. The seven-day budget
contains school/date/count only. Review Google Cloud quotas before a 300-device rollout.

Policies are rechecked when playback starts and every 15 seconds while viewing.
Approved search-result playback leases last one hour and disappear on process exit.
Downloads recheck the live catalogue before downloading and before committing the
file, validate expected size and media signatures, and use app-private storage.
Saved files remain offered offline until the device receives a withdrawal. This is
offline access, not instantaneous remote deletion. No browser or account is enabled.

## Verification scope

Automated checks cover school isolation, opt-in search and budget enforcement,
private-file visibility, ID/host rules, upload MIME aliases, student search and
queue actions, offline/old-agent behaviour, and responsive layouts. Native build,
signature and lint checks are recorded with the release artifact. A physical
Primebook test is still required for YouTube playback and actual media decoding.

References: [Search API](https://developers.google.com/youtube/v3/docs/search/list),
[official player](https://developers.google.com/youtube/iframe_api_reference),
[WebView identity requirements](https://developers.google.com/youtube/terms/required-minimum-functionality),
[developer policies](https://developers.google.com/youtube/terms/developer-policies).
