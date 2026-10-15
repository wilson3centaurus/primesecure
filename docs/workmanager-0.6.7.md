# WorkManager boot initialization: 0.6.7 (version code 13)

The pilot's 0.6.6 restart allowed login but produced fresh IllegalStateException failures from WorkManagerImpl.getInstance:179. These affected CheckInWorker.schedule/runNow, DiagnosticsWorker.schedule and HubSync.schedule. AgentService network callbacks and coroutine callbacks produced uncaught exceptions. This is evidence of a shared WorkManager initialization failure, rather than independent download or network errors. It does not establish the cause of the older PrimeOS login flashing.

AgentApp now implements WorkManager Configuration.Provider. The default WorkManager Startup metadata is removed while the other Startup initializers remain. All existing callers use getInstance(context), which can now initialize the singleton on demand after unlock, even when the app process was first created by a direct-boot receiver and the ordinary provider did not initialize it.

This follows Android's documented on-demand initialization:
https://developer.android.com/develop/background-work/background-tasks/persistent/configuration/custom-configuration

The ordinary boot receiver still avoids WorkManager while locked. The separate direct-boot recovery path continues to use its own network client. AgentService's network, realtime and periodic scheduling callbacks now report exceptions without terminating the app process or cancelling later periodic attempts.

Validation: release build, lint, existing 19 JVM tests, packaged manifest inspection, signer and non-test-only checks. No connected Android device or configured emulator is available here; these checks do not reproduce first-unlock lifecycle behavior. Physical validation remains required: install 0.6.7, leave the strict rule off, restart, wait for a fresh check-in, inspect logs after the restart, and open notes/app library to verify queued work.

Old crash records remain visible. A previous_process_exit event can report an older process failure using the new agent version. Fresh uncaught_exception or background_schedule_failed events after the new restart require investigation before strict-mode testing or fleet rollout.
