package com.robokorda.primesecure

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONObject
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.IOException
import java.util.concurrent.TimeUnit

class CheckInWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        if (!AgentStore(applicationContext).isEnrolled) return Result.success()
        return try {
            checkIn(applicationContext)
            Result.success()
        } catch (e: IOException) {
            Result.retry()
        } catch (e: ApiException) {
            if (e.code >= 500 || e.code == 429) Result.retry() else Result.success()
        }
    }

    companion object {
        private const val PERIODIC = "check-in"
        private const val NOW = "check-in-now"
        private val heartbeatLock = Mutex()

        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        /** WorkManager's minimum interval; survives reboots and app restarts on its own. */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<CheckInWorker>(15, TimeUnit.MINUTES)
                .setConstraints(online)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun runNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<CheckInWorker>()
                .setConstraints(online)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            // Append so a check-in triggered mid-run still happens after the current one.
            WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
        }

        fun cancel(context: Context) {
            AgentService.stop(context)
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
            WorkManager.getInstance(context).cancelUniqueWork(NOW)
            WorkManager.getInstance(context).cancelUniqueWork("student-hub-sync")
            WorkManager.getInstance(context).cancelUniqueWork("hub-outbox")
            WorkManager.getInstance(context).cancelUniqueWork("message-acknowledgements")
            WorkManager.getInstance(context).cancelUniqueWork("device-telemetry-now")
            WorkManager.getInstance(context).cancelUniqueWork("device-telemetry")
            WorkManager.getInstance(context).cancelUniqueWork("diagnostics-now")
            WorkManager.getInstance(context).cancelUniqueWork("diagnostics")
        }

        /** One heartbeat: report device state, receive status + policy, apply it, run queued commands. */
        suspend fun checkIn(context: Context): JSONObject = heartbeatLock.withLock { checkInUnlocked(context) }

        private suspend fun checkInUnlocked(context: Context): JSONObject {
            val store = AgentStore(context)
            try {
                DeviceInfo.grantOwnPermissions(context)
                val info = DeviceInfo.collect(context)
                val apps = runCatching { DeviceInfo.installedApps(context) }.getOrNull()
                val appsHash = apps?.toString()?.hashCode() ?: 0
                if (apps != null && appsHash != store.reportedAppsHash) info.put("apps", apps)
                val response = SupabaseApi(store).rpc("device_check_in", JSONObject().put("p_info", info))
                store.reportedAppsHash = when {
                    info.has("apps") -> appsHash
                    !response.optBoolean("apps_known", true) -> 0 // server lost it; resend next time
                    else -> store.reportedAppsHash
                }
                val status = response.optString("status")
                store.lastStatus = status
                store.lastStatusMessage = response.stringOrNull("status_message")
                LostMode.observe(context,response)
                if (status == "retired") {
                    DeviceState.apply(context, status) // forgets the enrollment; nothing more to do
                    return response
                }
                // A pending library download or a later network failure must not delay
                // the school's lost-device lock after the server has already requested it.
                if(status=="locked") DeviceState.apply(context,status)
                DeviceSafety.bind(context,store.deviceId!!)
                DeviceSafety.observe(context,response.optJSONObject("recovery_control"))
                val sync=SupabaseApi(store).rpc("device_sync_state")
                val syncRevision=sync.optLong("revision")
                val changesPending=syncRevision>sync.optLong("applied_revision")
                SettingsSync.observe(context,sync)
                SettingsSync.phase(context,"applying")
                val policy = response.optJSONObject("policy") ?: JSONObject()
                run {
                    val hub = SupabaseApi(store).rpc("device_hub").put("_sync_revision",syncRevision)
                    HubStore(context).catalog = hub
                    val local = HubStore(context).localWallpaper
                    if (local != null && HubTasks(context).pending().any { it.optString("action") == "wallpaper" } && hub.optBoolean("allow_wallpaper_choice")) {
                        val chosen = HubStore(context).items().find { it.optString("id") == local }
                        if (chosen != null) hub.put("wallpaper", chosen)
                    }
                    hub.optJSONObject("wallpaper")?.let { policy.put("wallpaper_url", "hub:" + it.getString("storage_path")).put("lock_wallpaper", true) }
                    if (hub.optBoolean("hide_vendor_store")) {
                        val hidden = policy.optJSONArray("hidden_apps") ?: org.json.JSONArray()
                        hidden.put("com.floydwiz.primestore")
                        policy.put("hidden_apps", hidden).put("block_installs", true)
                    }
                    hub.optJSONObject("management")?.let { management ->
                        policy.put("hub_management",management)
                        if(management.optBoolean("approved_apps_only")) {
                            policy.put("allowed_apps",management.optJSONArray("approved_packages") ?: org.json.JSONArray())
                                .put("hidden_apps",org.json.JSONArray().put("com.floydwiz.primestore")).put("block_installs",true).put("hide_settings",true)
                        }
                    }
                    runCatching {
                        AdminReceiver.dpm(context).setDeviceOwnerLockScreenInfo(AdminReceiver.component(context),"RoboKorda · ${hub.optString("school_name")}")
                    }
                    runCatching { SupabaseApi(store).rpc("device_battery_report", JSONObject().put("p_readings", DeviceInfo.batteryDiagnostics(context))) }
                }
                context.getSharedPreferences("agent-policy", Context.MODE_PRIVATE).edit().putString("policy", policy.toString()).putString("device",store.deviceId).commit()
                val applier = PolicyApplier(context, store)
                store.lastPolicySummary = applier.apply(policy, suspended = status == "suspended")
                InitialSetup(context).policyResult(applier.lastProblems)
                if(applier.lastProblems.isEmpty()) {
                    val wasPending=SettingsSync.pending(context)
                    SettingsSync.observe(context,SupabaseApi(store).rpc("device_ack_sync",JSONObject().put("p_revision",syncRevision)))
                    if(wasPending && !SettingsSync.pending(context)) {
                        DeviceLog.event(context,"info","policy","school_changes_applied")
                        Notifications.schoolSync(context,"School settings updated","Your settings and library list are synced. Books, wallpapers and app downloads continue in Background tasks.")
                    }
                } else SettingsSync.phase(context,"attention")
                DeviceState.apply(context, status)
                store.lastCheckInAt = System.currentTimeMillis()
                runCatching { BootRecovery.ensureChannel(context) }
                runCatching { PasswordRecovery.registerBoot(context) }
                runCatching { SupabaseApi(store).rpc("device_runtime_report", JSONObject().put("p_readings", DeviceRuntime.collect(context))) }
                if(LostMode.active(context)) runCatching { Locator(context,store).locateScheduled() }
                if(store.lastError!=null)DeviceLog.event(context,"info","check_in","connection_recovered")
                store.lastError = null
                DiagnosticsWorker.schedule(context)
                if (response.optInt("pending_commands", 0) > 0) CommandRunner(context, store).runPending()
                HubSync.schedule(context,followUp=changesPending)
                TelemetryWorker.schedule(context)
                // Last: a successful update replaces this process.
                SelfUpdater.maybeUpdate(context, store, response.optJSONObject("agent_update"))
                return response
            } catch (e: Exception) {
                if(e is kotlinx.coroutines.CancellationException)throw e
                DeviceLog.event(context,"error","check_in","check_in_failed",e)
                store.lastError = Connectivity.message(e)
                SettingsSync.phase(context,"waiting")
                throw e
            }
        }

        /** Exchanges an enroll token for this device's own account, then checks in. */
        suspend fun enroll(context: Context, token: String): JSONObject {
            val store = AgentStore(context)
            if (!AdminReceiver.isDeviceOwner(context)) {
                throw IllegalStateException("Not Device Owner yet — run the dpm set-device-owner command first")
            }
            DeviceInfo.grantOwnPermissions(context)
            val result = SupabaseApi(store).enroll(token.trim().uppercase(), DeviceInfo.collect(context))
            store.saveEnrollment(
                deviceId = result.getString("device_id"),
                email = result.getString("email"),
                password = result.getString("password"),
            )
            DeviceLog.bind(context,store.deviceId)
            DeviceLog.event(context,"info","setup","enrollment_registered")
            InitialSetup(context).begin()
            Provisioning.clear(context)
            schedule(context)
            AgentService.start(context)
            val response = checkIn(context)
            context.startActivity(InitialSetup(context).destination().addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
            return response
        }
    }
}
