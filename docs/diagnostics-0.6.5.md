# Device diagnostics (agent 0.6.5, version code 11)

Keep **Allow only school-approved apps** off until restart/login works on the pilot device and this logging agent has uploaded events. No rollout to the fleet should substitute for that device test.

Install the same-signed, non-test-only APK through Agent updates, then open the device page's **Device diagnostics** panel. It supports issue, boot/policy and all-event filters, search, refresh and JSON export. Only school managers and RoboKorda administrators can read diagnostics.

The agent records boot activity, policy changes and each planned app restriction, operation failures, uncaught exceptions, foreground UI stalls and Android-reported previous crashes/ANRs when available. These are PrimeSecure events, not full PrimeOS or kernel logs. Exception messages, passwords, tokens, student messages and document contents are excluded; error records contain exception types and code stack frames.

The device keeps a durable queue of at most 200 events, prioritising serious failures when full. Uploads retry after reconnection; the server deduplicates retries and retains the latest 1,000 events per device. The dashboard loads the latest 100. Uploaded events survive a device factory reset, while unsent local events do not. Deleting the device deletes its diagnostics.

Before-first-unlock uploads depend on an already registered boot-recovery channel, reachable network and PrimeOS support. Without those conditions, events wait locally until unlock. This feature cannot recover logs lost in the previous factory reset or guarantee an explanation for an operating-system login crash.

Build verification covers database permission, isolation, retry and retention tests; native privacy/formatting tests; Android release build/lint; and dashboard build/lint. Actual Primebook boot/error reporting still requires a physical-device test.
