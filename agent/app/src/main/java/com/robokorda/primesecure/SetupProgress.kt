package com.robokorda.primesecure

import android.content.Context
import android.os.SystemClock
import android.provider.Settings
import androidx.work.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Observed readiness of the current catalogue, not an ETA or a policy/enrollment completion claim. */
class SetupProgress(private val context: Context) {
    private val prefs = context.getSharedPreferences("setup-progress", Context.MODE_PRIVATE)

    fun reset() = synchronized(lock) { check(prefs.edit().clear().commit()) }

    fun snapshot(): JSONObject = synchronized(lock) {
        val store = AgentStore(context)
        if (prefs.getString("device", null) != store.deviceId) {
            check(prefs.edit().clear().putString("device", store.deviceId).commit())
        }
        val hub = HubStore(context)
        val catalog = hub.catalog
        val known = catalog.has("items") && !catalog.isNull("items")
        val all = hub.items()
        val required = InitialSetup.requiredApps(catalog, all).map { it.optString("id") }.toSet()
        val tracked = all.filter { it.optString("kind") in setOf("wallpaper", "resource") || it.optString("id") in required }
        val signature = MessageDigest.getInstance("SHA-256").digest(tracked.sortedBy { it.optString("id") }
            .joinToString("\n") { listOf(it.optString("id"), it.optString("kind"), it.optLong("size", -1),
                it.optString("sha256"), it.optString("storage_path"), it.optString("package_name")).joinToString("|") }.toByteArray())
            .joinToString("") { "%02x".format(it) }
        val now = System.currentTimeMillis()
        val uptime = SystemClock.elapsedRealtime()
        val boot = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)
        if (known && prefs.getString("signature", null) != signature) {
            check(prefs.edit().clear().putString("device", store.deviceId).putString("signature", signature)
                .putString("session", UUID.randomUUID().toString()).putLong("started", now)
                .putLong("elapsed", 0).putLong("uptime", uptime).putLong("wall", now).putInt("boot", boot).commit())
        }
        val previous = SetupClockReading(prefs.getLong("elapsed", 0), prefs.getLong("uptime", uptime),
            prefs.getLong("wall", now), prefs.getInt("boot", boot), prefs.getBoolean("estimated", false))
        val clock = SetupProgressMath.tick(previous, uptime, now, boot)
        val edit = prefs.edit().putLong("elapsed", clock.elapsed).putLong("uptime", uptime).putLong("wall", now)
            .putInt("boot", boot).putBoolean("estimated", clock.estimated)
        val tasks = HubTasks(context).all().groupBy { it.optString("item_id") }
        val streams = listOf("wallpaper" to "Wallpapers", "app" to "Apps", "resource" to "School notes").map { (kind, label) ->
            var completed = 0; var totalBytes = 0L; var received = 0L
            val items = tracked.filter { it.optString("kind") == kind }
            for (item in items) {
                val size = item.optLong("size", -1)
                totalBytes += size.coerceAtLeast(0)
                val ready = if (kind == "app") runCatching {
                    context.packageManager.getPackageInfo(item.getString("package_name"), 0)
                }.isSuccess else hub.resourceFile(item).let { it.exists() && size >= 0 && it.length() == size }
                if (ready) completed++
                val partial = if (kind == "app") tasks[item.optString("id")]?.maxOfOrNull { it.optLong("bytes") } ?: 0
                    else File(hub.resourceFile(item).path + ".part").let { if (it.exists()) it.length() else 0 }
                received += SetupProgressMath.received(size, partial, ready)
            }
            val complete = SetupProgressMath.complete(known, items.size, completed)
            val finished = if (complete) prefs.getLong("finished:$kind", clock.elapsed) else clock.elapsed
            if (complete) edit.putLong("finished:$kind", finished) else edit.remove("finished:$kind")
            JSONObject().put("kind", kind).put("label", label).put("total_items", items.size)
                .put("completed_items", completed).put("total_bytes", totalBytes).put("completed_bytes", received)
                .put("elapsed_ms", if (known) finished else 0).put("complete", complete)
                .put("unknown_size_items", items.count { it.optLong("size", -1) < 0 })
        }
        val complete = known && streams.all { it.optBoolean("complete") }
        val finished = if (complete) prefs.getLong("finished", clock.elapsed) else clock.elapsed
        if (complete) edit.putLong("finished", finished) else edit.remove("finished")
        check(edit.commit())
        JSONObject().put("streams", JSONArray(streams)).put("elapsed_ms", if (known) finished else 0)
            .put("complete", complete).put("catalog_known", known).put("session_id", prefs.getString("session", null) ?: JSONObject.NULL)
            .put("catalog_signature", signature).put("started_at_ms", prefs.getLong("started", 0))
            .put("duration_basis", "since_catalog_observed_including_offline_and_queue_wait")
            .put("clock_estimated", clock.estimated)
    }

    companion object {
        private val lock = Any()
        private var lastScheduled = 0L
        fun reportSoon(context: Context, final: Boolean = false) {
            val now = SystemClock.elapsedRealtime()
            synchronized(lock) {
                if (!final && now - lastScheduled in 0..14_999 && lastScheduled != 0L) return
                lastScheduled = now
            }
            val manager = WorkManager.getInstance(context)
            val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            manager.enqueueUniquePeriodicWork("setup-progress-periodic", ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<SetupProgressWorker>(15, TimeUnit.MINUTES).setConstraints(network).build())
            manager.enqueueUniqueWork("setup-progress-report", if (final) ExistingWorkPolicy.APPEND_OR_REPLACE else ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<SetupProgressWorker>().setConstraints(network).build())
        }
    }
}

/** Reporting failure never converts a successful download into a failed transfer. */
class SetupProgressWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = reporting.withLock { report() }
    private suspend fun report(): Result {
        val store = AgentStore(applicationContext)
        if (!store.isEnrolled || store.lastStatus == "retired") return Result.success()
        return try {
            val device = store.deviceId
            val snapshot = SetupProgress(applicationContext).snapshot()
            if (!snapshot.optBoolean("catalog_known") || store.deviceId != device) return Result.success()
            SupabaseApi(store).rpc("device_report_setup_progress", JSONObject().put("p_report", snapshot))
            Result.success()
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            Result.retry()
        }
    }
    companion object { private val reporting = Mutex() }
}
