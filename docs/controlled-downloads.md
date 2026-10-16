# Student downloads and help (agent 0.8.6)

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
the required native capability is installed. Agent 0.8.6 (23) is a non-test-only
release signed with the existing fleet key. Publish it paused for a one-device
pilot, select it in that device's Recovery & rollback controls, then test genuine
site downloads, offline Media, background retry and reboot before fleet rollout.
Build/unit/lint checks and browser previews do not replace that PrimeOS test.
