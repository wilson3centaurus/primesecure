# Login outage — 18 October 2026

All times below are UTC+02:00 (Africa/Harare).

| Time | Evidence |
| --- | --- |
| 14:39:56 | Host journal: `systemd-logind: Power key pressed short.` followed by `Powering off...` |
| 14:40:49 | Previous boot journal ends after an orderly shutdown; database and API were stopped with the host. |
| 14:57:41 | Host boot time. |
| 14:57:55–14:58:02 | Auth startup initially failed while PostgreSQL was starting. |
| 14:58:06 | Auth API started successfully. |
| 15:04:10 | Auth recorded a successful password sign-in; admin account exists, is confirmed, and is not banned. |
| 15:09 | Administrator confirmed dashboard access restored. |

- **Confirmed:** a host power-off caused roughly 18 minutes of service unavailability. Inspected containers subsequently reported healthy; nginx was active.
- **Not established:** who or what generated the virtual power-button event. The guest journal alone cannot attribute it to a hosting-panel action, provider operation, or person. Hosting control-plane audit history is needed for attribution.
- **Misleading UI:** the login action returned “Wrong email or password” for every authentication error, including transport and service failures. It now distinguishes invalid credentials, rate limits, unconfirmed email, and unavailable service; unexpected request failures also produce the service message.
- **Privacy:** login diagnostics record only status and a credential-error flag, with no email, password, tokens, or raw payloads.
- **Validation:** action tests cover rejected credentials, transport failures, HTTP 502/503/504, rate limits, unconfirmed email, and successful redirect. TypeScript check passed. Host, database, and account inspection was read-only; no credentials were reset and no host restart was requested during this investigation.
- **Remaining availability risk:** a single VPS shutdown still interrupts authentication and the API. The login-message fix does not provide failover or prevent power-off.
