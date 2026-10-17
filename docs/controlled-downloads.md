# Student downloads and help (agent 0.8.8)

Settings > Web filtering > Student media downloads adds the two entry domains
to the school's existing allowlist. Save the policy to apply it. Removing a
domain withdraws access. General browsers can remain hidden and blocked.

The student Downloads page opens MP3Juices or Unsplash in the isolated approved
website view. It has no address bar, privileged JavaScript bridge, external
windows, file uploads or arbitrary navigation. Each download requires student
confirmation. Ordinary approved web apps still cannot download files.

The native worker accepts only recognised image or audio/video bytes, follows
approved HTTPS redirects, checks school approval again during a download,
resumes supported partial transfers, reports background progress and saves
finished files into Media. Image downloads are limited to 25 MB; audio/video to
250 MB. HTML, SVG, PDFs, ZIPs and APKs are rejected. Cached partial files are
private to PrimeSecure. Server authentication tokens are never sent to these sites.

Public search results are supplied by the external sites and are not individually
reviewed by school staff. Unsplash can display paid content. Students should use
school-appropriate material they have permission to download. Changing a site's
download CDN can require an approved-host update; do not enable unrestricted
browsing to work around a blocked link.

Help & guide is available in the sidebar and top bar, including searchable FAQs,
an illustrated notes/download walkthrough, Support links and the supplied USD
repair prices. It accurately explains that authorised staff can read support
messages and identify anonymous school-message replies. The current service is
not end-to-end encrypted.

The signed interface is available to older agents, with downloads disabled until
the required native capability is installed. Agent 0.8.8 (25) is a non-test-only
release signed with the existing fleet key. Publish it paused for a one-device
pilot, select it in that device's Recovery & rollback controls, then test genuine
site downloads, offline Media, background retry and reboot before fleet rollout.
Build/unit/lint checks and browser previews do not replace that PrimeOS test.

## New tabs, redirects and configurable event URLs (0.8.8 / 25)

Settings > Web filtering > Student media downloads > **Configure URLs by event**
has a separate editor for Music & videos and Images:

| Event | What to approve | What it does not grant |
|---|---|---|
| Start / search page | The chosen entry URL; explicitly approve its host in Allowed websites | General browsing |
| New tab / redirect / preview page | The actual converter or preview URL, such as `https://api.ytmp3.tube/mp3` | Permission to save arbitrary files |
| Supporting scripts, images & services | Required asset/API domains | Permission to navigate to those domains |
| Actual music, video or image file | The media CDN/domain or stable file-URL prefix | Permission to browse its HTML pages |

The start host is included in each event. A domain entry includes subdomains; a
full HTTPS URL restricts the exact host and path prefix. Query parameters are
ignored/removed from saved rules; avoid pasting temporary signed file URLs.
Clearing an event list removes its extra permissions. A device policy overrides
the school policy in the same way as existing web rules.

Download tools capture a user-initiated new-window request (or one shortly after
a click/key press), check the target, then reuse the visible PrimeSecure window.
They do not open Chrome or a separate browsing window. Ordinary Tinkercad/web
wrappers keep their existing popup restrictions. File saving still asks for
confirmation and validates actual media bytes. Pending captures close when the
activity pauses; no unlimited child-window stack is created.

`omg10.com` and `extroverted-roll.com` from the reported flow are treated as
advertising/tracking destinations, not approved media providers. Those hosts and
the previously identified ad services remain blocked even if accidentally listed.
Do not make a rotating advertisement chain part of the download allowlist.

Diagnostics `web_event_blocked` identifies the event, host and URL without query
parameters. `school_web_download_blocked` reports the failed download host/path.
Review these before approving a missing converter/CDN. URL removal is rechecked
during page use, worker redirects and downloads; a queued file is not exempt from
the current policy. Once 0.8.8 is installed, URL edits arrive through policy sync
without rebuilding the APK. POST-only popup flows, blob downloads and site/CDN
changes may still require investigation. Test the real flow on one Primebook.
