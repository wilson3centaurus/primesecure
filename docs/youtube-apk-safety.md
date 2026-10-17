# YouTube APK filtering on school Primebooks

PrimeSecure's Prime Media search and the separate YouTube APK are different enforcement surfaces.

| Surface | Current control | Limitation |
|---|---|---|
| Prime Media | YouTube API Strict SafeSearch, school opt-in/channel lists, additional explicit-query check | Filters are not a guarantee that every returned video is suitable. Cached results may remain briefly. |
| Chrome | Existing managed SafeSearch / YouTube settings | Chrome policy is not a policy for the YouTube APK. |
| YouTube APK | Google's account/network Restricted Mode | PrimeSecure cannot inspect its encrypted searches or impose its own keyword list on this app. |

## Enforce Strict Restricted Mode for the APK

Use the school's Google Workspace administration to set students to **Strict Restricted YouTube access**. Apply the students' organisational unit and confirm they are signed in with those managed accounts. Personal accounts and signed-out use need network enforcement too. Keep teacher permissions separate; do not give students unrestricted/approver permissions.

On the school DNS resolver, Google's documented strict-mode configuration is:

| DNS hostname | CNAME target |
|---|---|
| `www.youtube.com` | `restrict.youtube.com` |
| `m.youtube.com` | `restrict.youtube.com` |
| `youtubei.googleapis.com` | `restrict.youtube.com` |
| `youtube.googleapis.com` | `restrict.youtube.com` |
| `www.youtube-nocookie.com` | `restrict.youtube.com` |

Do not apply that rewrite to all Google/YouTube hostnames. Google specifically warns against rewriting bare `youtube.com`, `youtu.be`, `s.ytimg.com`, `googleapis.com`, or `youtubeeducation.com` this way.

The resolver/router must actually enforce use of the filtering DNS. Merely adding DNS records on our public server does not change the Primebook's resolver. Phone hotspots, alternative DNS/VPNs, personal accounts and signed-out use must be tested. A school Wi-Fi policy does not automatically protect a device on another network. PrimeSecure does not currently implement an always-on filtering VPN.

Google states that header filtering is not supported for core applications, so adding `YouTube-Restrict: Strict` to PrimeSecure's own HTTP client is not a solution for the YouTube APK.

## Pilot verification

- Use the official YouTube app, then test signed-in and signed-out behaviour.
- Confirm Google's [content restriction diagnostics](https://www.youtube.com/check_content_restrictions) reports the expected network/account restrictions. This page alone is not proof that every app request follows the same route.
- Test the reported query and a set of normal learning searches on school Wi-Fi and a phone hotspot.
- Check that settings/account changes cannot remove the intended restrictions on the actual PrimeOS build.
- If filtering cannot be enforced, keep the unrestricted APK out of the approved student app list and use controlled Prime Media/channel access instead.

This document is configuration guidance, not confirmation that the school router or Google Admin has been changed.

Sources: [Google network instructions](https://knowledge.workspace.google.com/admin/youtube/control-youtube-content-available-to-users), [Google Workspace YouTube settings](https://knowledge.workspace.google.com/admin/youtube/manage-your-organizations-youtube-settings), [Restricted Mode limitations](https://support.google.com/youtube/answer/174084).
