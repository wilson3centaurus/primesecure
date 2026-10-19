package com.robokorda.primesecure

import android.content.Context
import android.os.SystemClock
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

class HubSync(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = coroutineScope {
        val reporting = launch { while (isActive) { SetupProgress.reportSoon(applicationContext); delay(15_000) } }
        try {
            transfers.withLock {
                withTimeoutOrNull(HubSyncScheduling.WORKER_MILLIS) { sync() } ?: run {
                    enqueue(applicationContext, HubSyncQueuePolicy.APPEND)
                    Result.success()
                }
            }
        } finally { reporting.cancel() }
    }

    private suspend fun sync(): Result {
        val store = AgentStore(applicationContext)
        if (!store.isEnrolled || store.lastStatus == "retired") return Result.success()
        val hub = HubStore(applicationContext); val tasks = HubTasks(applicationContext)
        val device = store.deviceId; val api = SupabaseApi(store)
        // Outbox work must not wait behind a large catalogue transfer or a broken wallpaper.
        if (tasks.pending().any { it.optString("action") !in setOf("install", "download", "web_download", "admin_command") })
            OfflineWorker.schedule(applicationContext)
        return try {
            val checkpoint = applicationContext.getSharedPreferences("hub-sync-scheduling", Context.MODE_PRIVATE)
            if (checkpoint.getString("device", null) != device) checkpoint.edit().clear().putString("device", device).commit()
            if (inputData.getBoolean("force", false) && runAttemptCount == 0) checkpoint.edit().remove("failures").commit()
            val revision=api.rpc("device_sync_state").optLong("revision")
            hub.catalog = api.rpc("device_hub").put("_sync_revision",revision).put("catalog_fetched_at_ms", System.currentTimeMillis())
            if (store.deviceId != device) return Result.success()
            // Do not wait for thousands of school files (or a failed item) before checking UI fixes.
            StudentUiUpdates.check(applicationContext)
            Notifications.supportReplies(applicationContext,hub.catalog)
            val draft=hub.profileDraft;val saved=hub.catalog.optJSONObject("student_profile")
            if(draft!=null && saved!=null && tasks.pending().none { it.optString("action")=="profile" } && draft.keys().asSequence().all { draft.optString(it,"")==saved.optString(it,"").let { value->if(value=="null") "" else value } }) hub.profileDraft=null
            val history = api.rpc("device_message_history")
            hub.catalog = JSONObject(hub.catalog.toString()).put("replies", history.optJSONArray("replies"))
            hub.removeMessages(history.stringSet("deleted_ids"))
            val messages = history.optJSONArray("messages")
            if (messages != null) for (i in 0 until messages.length()) {
                val m = messages.getJSONObject(i)
                hub.saveMessage(m.getString("id"), m.getJSONObject("payload"), m.getString("created_at"))
                if (!m.isNull("acknowledged_at")) hub.acknowledge(m.getString("id"), true)
                if (!m.isNull("seen_at")) hub.seen(m.getString("id"), true)
            }
            withContext(Dispatchers.Main) { MessageActivity.showPending(applicationContext) }
            MessageAckWorker.schedule(applicationContext)
            InitialSetup(applicationContext).catalogReceived()
            SetupProgress(applicationContext).snapshot()
            SetupProgress.reportSoon(applicationContext)
            val deferredFailures = checkpoint.getStringSet("failures", emptySet())!!.toMutableSet()
            var installs = emptyMap<String?, JSONObject>()
            var downloads = emptyMap<String, JSONObject>()
            var cachedTasks = emptyMap<String, List<JSONObject>>()
            var lastCatalogPoll = SystemClock.elapsedRealtime()
            // This is the only executor for queued catalogue installs AND school-file transfers.
            // Failed entries are attempted once per round, including across bounded batches.
            val pass = SetupDownloadOrder.runBoundedPass(load = {
                currentCoroutineContext().ensureActive()
                if (SystemClock.elapsedRealtime() - lastCatalogPoll >= 15_000) {
                    val currentRevision = api.rpc("device_sync_state").optLong("revision")
                    if (currentRevision != hub.catalog.optLong("_sync_revision", -1)) {
                        hub.catalog = api.rpc("device_hub").put("_sync_revision", currentRevision).put("catalog_fetched_at_ms", System.currentTimeMillis())
                        SetupProgress.reportSoon(applicationContext)
                    }
                    lastCatalogPoll = SystemClock.elapsedRealtime()
                }
                if (store.deviceId != device) throw kotlinx.coroutines.CancellationException("Enrollment changed")
                if (store.lastStatus == "active") for (required in InitialSetup.requiredApps(hub.catalog, hub.items())) {
                    val id = required.getString("id")
                    val path = required.optString("storage_path")
                    val hash = required.optString("sha256")
                    val identity = HubInstallRetryRules.identity(path, hash)
                    val pending = tasks.pending().any { it.optString("action") == "install" && it.optString("item_id") == id }
                    if (!runCatching { applicationContext.packageManager.getPackageInfo(required.getString("package_name"), 0) }.isSuccess &&
                        HubInstallRetryRules.shouldAutoEnqueue(identity, checkpoint.getString("failed-app:$id", null), pending))
                        tasks.enqueue("install", JSONObject().put("item_id", id).put("catalog_sha256", hash).put("catalog_path", path),
                            required.getString("title"), "install:$id:$hash")
                }
                installs = tasks.pending().filter { it.optString("action") == "install" }
                    .associateBy { it.optJSONObject("payload")?.optString("item_id") }
                downloads = hub.items().filter { it.optString("kind") in setOf("resource", "wallpaper") ||
                    (store.lastStatus == "active" && it.optString("kind") == "app" && it.optString("id") in installs) }
                    .associateBy { it.getString("id") }
                cachedTasks = tasks.pending().filter { it.optString("action") == "download" }
                    .groupBy { it.optString("item_id") }
                val pending = mutableListOf<SetupDownload>()
                for (item in downloads.values) {
                    if (item.optString("kind") != "app") {
                        val target = hub.resourceFile(item)
                        if (target.exists() && item.optLong("size", -1) >= 0 && target.length() == item.optLong("size")) {
                            completeCachedDownload(item, target, tasks, cachedTasks[item.getString("id")].orEmpty())
                            if (item.optString("kind") == "wallpaper") preview(item, target)
                            continue
                        }
                    }
                    pending += SetupDownload(item.getString("id"), item.optString("kind"), item.optLong("size", -1),
                        item.optString("title"), item.optString("form_level"), item.optString("subject"),
                        item.optString("category"), item.optString("mime_type"), item.optString("storage_path"), item.optString("sha256"))
                }
                pending
            }, now = SystemClock::elapsedRealtime, deferredFailures = deferredFailures, record = { planned, success ->
                if (!success) {
                    deferredFailures += planned.workKey
                    check(checkpoint.edit().putStringSet("failures", deferredFailures.toSet()).commit()) { "Could not save transfer checkpoint" }
                }
            }) { planned, attemptMillis ->
                if (store.deviceId != device) throw kotlinx.coroutines.CancellationException("Enrollment changed")
                val item = downloads.getValue(planned.id)
                if (planned.kind == "app") {
                    val task = installs.getValue(planned.id).getString("id")
                    try {
                        check(withTimeoutOrNull(attemptMillis) {
                            install(item, task, api, store, hub, tasks); true
                        } == true) { "App attempt timed out. Later downloads continue; this app can retry." }
                        SetupProgress.reportSoon(applicationContext)
                        true
                    } catch (e: Exception) {
                        if (e is kotlinx.coroutines.CancellationException) {
                            tasks.update(task, "queued")
                            throw e
                        }
                        DeviceLog.event(applicationContext, "error", "install", "setup_install_failed", e)
                        val terminal = HubInstallRetryRules.terminal(e)
                        if (terminal) {
                            val failedItem = hub.items().find { it.optString("id") == planned.id } ?: item
                            val identity = HubInstallRetryRules.identity(failedItem.optString("storage_path"), failedItem.optString("sha256"))
                            check(checkpoint.edit().putString("failed-app:${planned.id}", identity).commit()) { "Could not save failed app checkpoint" }
                        }
                        tasks.update(task, if (terminal) "failed" else "waiting", error = Connectivity.message(e))
                        // A terminal task is settled, not a reason to schedule an endless retry round.
                        terminal
                    }
                } else {
                val target = hub.resourceFile(item)
                if (target.exists() && item.optLong("size", -1) >= 0 && target.length() == item.optLong("size")) {
                    completeCachedDownload(item, target, tasks, cachedTasks[item.getString("id")].orEmpty())
                    if (item.optString("kind") == "wallpaper") preview(item, target)
                    return@runBoundedPass true
                }
                val id = tasks.download(item.getString("id"), item.getString("title"), item.optLong("size", -1))
                val temp = File(target.path + ".part")
                try {
                    check(withTimeoutOrNull(attemptMillis) {
                    check(item.optLong("size", -1) >= 0) { "The catalogue file size is unknown." }
                    if (target.parentFile!!.usableSpace < (item.getLong("size") - temp.length()).coerceAtLeast(0) + 100L * 1024 * 1024)
                        error("Storage is nearly full. Free some space to continue this download.")
                    if (temp.length() > item.getLong("size")) temp.delete()
                    if (temp.length() != item.getLong("size")) {
                        api.download("/storage/v1/object/primesecure-hub/${item.getString("storage_path")}", temp, resume = true) { bytes, total, speed ->
                        tasks.update(id, "downloading", bytes, total, speed)
                        SetupProgress.reportSoon(applicationContext)
                        }
                    }
                    check(temp.length() == item.getLong("size")) { "The download is incomplete. It will resume when connected." }
                    item.stringOrNull("sha256")?.let { expected ->
                        val hash = java.security.MessageDigest.getInstance("SHA-256")
                        temp.inputStream().use { input -> val buffer = ByteArray(65536); while (true) { currentCoroutineContext().ensureActive(); val n = input.read(buffer); if (n < 0) break; hash.update(buffer, 0, n) } }
                        if (!hash.digest().joinToString("") { "%02x".format(it) }.equals(expected, true)) { temp.delete(); error("Damaged download. Please retry.") }
                    }
                    check(temp.renameTo(target)) { "Could not save the download." }
                    tasks.update(id, "done", target.length(), target.length())
                    if (item.optString("kind") == "wallpaper") preview(item, target)
                    SetupProgress.reportSoon(applicationContext)
                    true
                    } == true) { "Transfer attempt timed out. Later downloads continue; this file will resume." }
                    true
                } catch (e: Exception) {
                    if (e is kotlinx.coroutines.CancellationException) {
                        tasks.update(id, "queued")
                        throw e
                    }
                    DeviceLog.event(applicationContext,"error","download","resource_download_failed",e)
                    tasks.update(id, "waiting", error = Connectivity.message(e))
                    hub.syncError = Connectivity.message(e)
                    false
                }
                }
            }
            // Retired items are no longer offered, even if downloaded; do not delete student files.
            val available = hub.items().map { it.getString("id") }.toSet()
            tasks.pending().filter { it.optString("key").startsWith("download:") && it.optJSONObject("payload")?.optString("item_id") !in available }.forEach { tasks.update(it.getString("id"), "superseded") }
            installs.filterKeys { id -> hub.items().none { it.optString("id") == id && it.optString("kind") == "app" } }
                .values.forEach { tasks.update(it.getString("id"), "superseded") }
            val failed = !pass.successful || deferredFailures.isNotEmpty()
            if (!failed) hub.syncError = null
            SetupProgress.reportSoon(applicationContext, final = true)
            if (pass.deferred) {
                enqueue(applicationContext, HubSyncQueuePolicy.APPEND)
            } else {
                checkpoint.edit().remove("failures").commit()
                if (failed) enqueue(applicationContext, HubSyncQueuePolicy.APPEND, HubSyncScheduling.FAILURE_DELAY_MILLIS)
                // Message attachments must not block newly queued
                // wallpapers or hold the school streams behind an unbounded attachment loop.
                if (!failed) {
                    withTimeoutOrNull(30_000L) { cacheMessageImages(hub, tasks, api) }
                }
            }
            Result.success()
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            DeviceLog.event(applicationContext,"error","download","hub_sync_failed",e)
            hub.syncError = Connectivity.message(e)
            SetupProgress.reportSoon(applicationContext, final = true)
            // A transient catalog/DNS failure must not hold the unique chain in hours of
            // exponential WorkManager backoff after connectivity has already recovered.
            enqueue(applicationContext, HubSyncQueuePolicy.APPEND, HubSyncScheduling.FAILURE_DELAY_MILLIS)
            Result.success()
        }
    }
    private suspend fun completeCachedDownload(item: JSONObject, file: File, tasks: HubTasks, candidates: List<JSONObject>) {
        val matches = candidates.filter {
            CachedDownloadRules.matches(item.optString("kind"), item.optString("id"), it.optString("action"),
                it.optString("key"), it.optString("item_id"), it.optString("status"))
        }
        if (matches.isEmpty()) return
        val coroutine = currentCoroutineContext()
        val ready = withContext(Dispatchers.IO) {
            CachedDownloadRules.ready(file, item.optLong("size", -1), item.stringOrNull("sha256")) { coroutine.ensureActive() }
        }
        if (ready) for (task in matches) {
            currentCoroutineContext().ensureActive()
            tasks.update(task.getString("id"), "done", file.length(), file.length())
        }
    }
    private suspend fun cacheMessageImages(hub: HubStore, tasks: HubTasks, api: SupabaseApi) {
        var attempts = 0
        for (message in hub.messages()) runCatching {
            val path = message.getJSONObject("payload").stringOrNull("image_path") ?: return@runCatching
            val hash = java.security.MessageDigest.getInstance("SHA-256").digest(path.toByteArray()).joinToString("") { "%02x".format(it) }
            val cached = File(applicationContext.filesDir, "message-image-$hash")
            if (!cached.exists() && attempts < 2) {
                attempts++
                val task = tasks.enqueue("download", JSONObject().put("item_id", "message:${message.getString("id")}"), "Message image", "message-image:$hash")
                val part = File(cached.path + ".part")
                try {
                    api.download("/storage/v1/object/primesecure-messages/$path", part, resume = true, maxBytes = 8_000_000) { bytes, total, speed ->
                        tasks.update(task, "downloading", bytes, total, speed)
                    }
                    check(part.length() <= 8_000_000 && part.renameTo(cached))
                    tasks.update(task, "done", cached.length(), cached.length())
                } catch (e: Exception) {
                    tasks.update(task, if (e is kotlinx.coroutines.CancellationException) "queued" else "waiting", error = if (e is kotlinx.coroutines.CancellationException) null else Connectivity.message(e))
                    throw e
                }
            }
        }.onFailure { if (it is kotlinx.coroutines.CancellationException) throw it }
    }
    private suspend fun install(item: JSONObject, task: String, api: SupabaseApi, store: AgentStore, hub: HubStore, tasks: HubTasks) {
        val revision = api.rpc("device_sync_state").optLong("revision")
        val catalog = api.rpc("device_hub").put("_sync_revision", revision).put("catalog_fetched_at_ms", System.currentTimeMillis())
        hub.catalog = catalog
        check(catalog.optString("status", store.lastStatus) == "active") { "App installs require an active school device." }
        val fresh = catalog.optJSONArray("items") ?: org.json.JSONArray()
        val approved = (0 until fresh.length()).map { fresh.getJSONObject(it) }.find {
            it.optString("id") == item.optString("id") && it.optString("kind") == "app"
        } ?: error("This app is no longer approved for your school.")
        val queued = tasks.all().find { it.optString("id") == task }
        val installed = runCatching { applicationContext.packageManager.getPackageInfo(approved.getString("package_name"), 0) }.isSuccess
        if (ApkSetPlan.shouldInstall(installed, PsApkArchive.isSet(approved.getString("storage_path")),
                queued?.optJSONObject("payload")?.optBoolean("force") == true,
                queued?.optString("error")?.let { it.isNotBlank() && it != "null" } == true)) {
            tasks.update(task, "syncing")
            AppInstaller(applicationContext, store).install(task, JSONObject().put("bucket", "primesecure-hub")
                .put("storage_path", approved.getString("storage_path")).put("hub_item_id", approved.getString("id"))
                .put("package", approved.getString("package_name")).put("sha256", approved.optString("sha256")), task)
        }
        tasks.update(task, "installed")
        applicationContext.getSharedPreferences("hub-sync-scheduling", Context.MODE_PRIVATE).edit().remove("failed-app:${approved.getString("id")}").commit()
    }
    private suspend fun preview(item: JSONObject, target: File) = withContext(Dispatchers.IO) {
        runCatching {
            val file = File(applicationContext.filesDir, "hub-preview-${item.getString("id")}.jpg")
            if (!file.exists()) {
                val options = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
                android.graphics.BitmapFactory.decodeFile(target.path, options)
                options.inJustDecodeBounds = false; options.inSampleSize = maxOf(1, maxOf(options.outWidth, options.outHeight) / 400)
                android.graphics.BitmapFactory.decodeFile(target.path, options)?.let { bitmap ->
                    file.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 75, it) }; bitmap.recycle()
                }
            }
        }
        Unit
    }
    companion object {
        private val transfers = Mutex()
        /** Only an explicit user action should pass force=true. Routine check-ins retain KEEP. */
        fun schedule(context: Context, followUp: Boolean = false, force: Boolean = false) {
            enqueue(context, HubSyncScheduling.policy(followUp, force))
        }
        private fun enqueue(context: Context, policy: HubSyncQueuePolicy, delayMillis: Long = 0) {
            val existing = when (policy) {
                HubSyncQueuePolicy.KEEP -> ExistingWorkPolicy.KEEP
                HubSyncQueuePolicy.APPEND -> ExistingWorkPolicy.APPEND_OR_REPLACE
                HubSyncQueuePolicy.REPLACE -> ExistingWorkPolicy.REPLACE
            }
            WorkManager.getInstance(context).enqueueUniqueWork("student-hub-sync", existing,
                OneTimeWorkRequestBuilder<HubSync>().setInputData(workDataOf("force" to (policy == HubSyncQueuePolicy.REPLACE)))
                    .setInitialDelay(delayMillis, TimeUnit.MILLISECONDS)
                    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
        }
    }
}
