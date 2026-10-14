package com.robokorda.primesecure

import android.content.Context
import androidx.work.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class OfflineWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = lock.withLock {
        val store = AgentStore(applicationContext)
        if (!store.isEnrolled || store.lastStatus == "retired") return@withLock Result.success()
        val hub = HubStore(applicationContext); val tasks = HubTasks(applicationContext); val api = SupabaseApi(store)
        val device = store.deviceId
        for (task in tasks.pending().filter { it.optString("action") !in setOf("download", "admin_command") }) {
            if (store.deviceId != device) return@withLock Result.success()
            val id = task.getString("id"); val action = task.getString("action"); val payload = task.getJSONObject("payload")
            try {
                tasks.update(id, "syncing")
                if (action == "install") {
                    val catalog = api.rpc("device_hub"); hub.catalog = catalog
                    check(catalog.optString("status",store.lastStatus) == "active") { "App installs are available only on active school devices." }
                    val item = hub.items().find { it.optString("id") == payload.optString("item_id") && it.optString("kind") == "app" }
                        ?: error("This app is no longer approved for your school.")
                    if (!runCatching { applicationContext.packageManager.getPackageInfo(item.getString("package_name"), 0) }.isSuccess) {
                        AppInstaller(applicationContext, store).install(id, JSONObject().put("bucket", "primesecure-hub").put("storage_path", item.getString("storage_path"))
                            .put("hub_item_id", item.getString("id")).put("package", item.getString("package_name")).put("sha256", item.optString("sha256")), id)
                    }
                    tasks.update(id, "installed")
                } else {
                    api.rpc("device_offline_action", JSONObject().put("p_request_id", id).put("p_action", action).put("p_payload", payload))
                    tasks.update(id, "done")
                    // Keep the local profile until a fresh catalog confirms the saved values.
                }
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (e is IOException || (e is ApiException && (e.code >= 500 || e.code == 429))) {
                    tasks.update(id, "waiting", error = Connectivity.message(e)); return@withLock Result.retry()
                }
                tasks.update(id, "failed", error = Connectivity.message(e))
            }
        }
        HubSync.schedule(applicationContext)
        Result.success()
    }
    companion object {
        private val lock = Mutex()
        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniqueWork("hub-outbox", ExistingWorkPolicy.APPEND_OR_REPLACE,
                OneTimeWorkRequestBuilder<OfflineWorker>().setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS).build())
        }
    }
}
