# Prime Media · 0.8.10 (27)

Students open **Prime Media** directly to a centred video search. The hero card, collection tabs and Downloaded tab have been removed. Results show cached video covers and a play button; playback opens over the results inside PrimeSecure. Saved school audio/video is available in **Media**. Administrators use **Content & files → Prime Media**.

| Collection | Student action | School control |
|---|---|---|
| YouTube search | Submit a search; select a school channel when configured | Explicit school opt-in; Strict SafeSearch; optional channel list |
| Uploaded audio/video | Queue a download, including offline; play the saved file | Upload MP3/M4A/OGG/WAV/MP4/WebM, max 250 MB; withdraw access |
| Media | Play saved school files offline | Downloads are on demand, not automatically pushed to every device |

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
5. Install 0.8.10 on one pilot device via Recovery & rollback. Test playback, offline
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

## Playback fix and covers

0.8.10 serves a local player document through a strict native handler and permits
only that document or the exact selected embed as a main page. This avoids the
previous unconditional main-frame denial. It also ignores player state changes
before YouTube supplies the video ID. HTTP/load failures report a host/path/code
without query tokens to Device diagnostics. The PrimeOS symptom still requires a
physical retest; these changes are not proof that every YouTube video will play.

Thumbnail requests stay on the local workspace origin. Native code fetches only
fixed `i.ytimg.com/vi/VIDEO_ID/mqdefault.jpg` URLs for known, authorised video IDs,
without credentials, cookies or redirects. Downloads are bounded to 250 KB and
60 cached JPEGs; unknown hosts or arbitrary URLs cannot be fetched this way.
MP3/MP4 buttons represent actual school-provided files, never a YouTube conversion.
