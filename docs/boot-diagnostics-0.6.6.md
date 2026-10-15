# Boot diagnostics follow-up: 0.6.6 (version code 12)

The pilot Primebook restarted and allowed login on 0.6.5 with the strict app rule off. Its uploaded diagnostics nevertheless recorded an uncaught RuntimeException in Android's ActivityThread.handleReceiver around 19:02 on 15 October 2026, followed by process restart and boot-unlocked activity. This confirms a receiver-related app crash, not the identity of the receiver or its underlying exception, and does not establish the cause of the earlier PrimeOS login flashing.

0.6.6 reports the underlying exception type and stack frames rather than only Android's outer wrapper. Traversal is bounded and cycle-safe; exception messages and file names remain excluded.

The agent's ordinary boot receiver now waits for unlocked credential storage, performs initialization off the main thread using goAsync, isolates each scheduling/service/message step, records a failed step with its phase, continues the remaining steps, and always finishes the pending broadcast. Direct-boot safety restoration remains in the separate receiver. This contains failures in this receiver; it is not a claim that the precise cause of the observed crash has been reproduced or resolved.

Keep the strict rule off. Install 0.6.6, restart the pilot and inspect new boot events. Older crash entries remain in history; compare event timestamps and agent versions. An Android previous-process-exit entry can refer to an older process failure discovered after the upgrade.

Only after boot reporting is checked should a single-device strict-rule pilot be considered. Password recovery is not a policy rollback; before-unlock policy rollback is not implemented by that restricted recovery channel. Fleet rollout remains pending physical testing.
