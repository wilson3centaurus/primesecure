package com.robokorda.primesecure

import android.content.Context
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.io.File

class HubSync(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = coroutineScope {
        val reporting = launch { while (isActive) { SetupProgress.reportSoon(applicationContext); delay(15_000) } }
        try { transfers.withLock { sync() } } finally { reporting.cancel() }
    }

    private suspend fun sync(): Result {
        val store = AgentStore(applicationContext)
        if (!store.isEnrolled || store.lastStatus == "retired") return Result.success()
        StudentUiUpdates.check(applicationContext)
        val hub = HubStore(applicationContext); val tasks = HubTasks(applicationContext)
        val device = store.deviceId; val api = SupabaseApi(store)
        // Outbox work must not wait behind a large catalogue transfer or a broken wallpaper.
        if (tasks.pending().any { it.optString("action") !in setOf("install", "download", "web_download", "admin_command") })
            OfflineWorker.schedule(applicationContext)
        return try {
            val revision=api.rpc("device_sync_state").optLong("revision")
            hub.catalog = api.rpc("device_hub").put("_sync_revision",revision)
            if (store.deviceId != device) return Result.success()
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
            for(message in hub.messages()) runCatching {
                val payload=message.getJSONObject("payload");val path=payload.stringOrNull("image_path") ?: return@runCatching
                val hash=java.security.MessageDigest.getInstance("SHA-256").digest(path.toByteArray()).joinToString("") { "%02x".format(it) }
                val cached=File(applicationContext.filesDir,"message-image-$hash")
                if(!cached.exists()) {
                    val task=tasks.enqueue("download",JSONObject().put("item_id","message:${message.getString("id")}"),"Message image","message-image:$hash")
                    val part=File(cached.path+".part")
                    try {
                        api.download("/storage/v1/object/primesecure-messages/$path",part,resume=true) { bytes,total,speed ->
                            check(total<=8_000_000&&bytes<=8_000_000) { "Message image is too large." };tasks.update(task,"downloading",bytes,total,speed)
                        }
                        check(part.length()<=8_000_000&&part.renameTo(cached));tasks.update(task,"done",cached.length(),cached.length())
                    } catch(e:Exception) { tasks.update(task,"waiting",error=Connectivity.message(e));throw e }
                }
            }.onFailure { if(it is kotlinx.coroutines.CancellationException) throw it }
            if (store.lastStatus == "active") for (item in InitialSetup.requiredApps(hub.catalog, hub.items())) {
                if (!runCatching { applicationContext.packageManager.getPackageInfo(item.getString("package_name"), 0) }.isSuccess) {
                    tasks.enqueue("install", JSONObject().put("item_id", item.getString("id")), item.getString("title"), "install:${item.getString("id")}")
                }
            }
            InitialSetup(applicationContext).catalogReceived()
            SetupProgress(applicationContext).snapshot()
            SetupProgress.reportSoon(applicationContext)
            val installs = tasks.pending().filter { it.optString("action") == "install" }
                .associateBy { it.optJSONObject("payload")?.optString("item_id") }
            val downloads = hub.items().filter { it.optString("kind") in setOf("resource", "wallpaper") ||
                (store.lastStatus == "active" && it.optString("kind") == "app" && it.optString("id") in installs) }
                .associateBy { it.getString("id") }
            // This is the only executor for queued catalogue installs AND school-file transfers.
            // Failed entries are attempted once per pass; later streams still get their turn.
            val successful = SetupDownloadOrder.runPass(downloads.values.map { item ->
                SetupDownload(item.getString("id"), item.optString("kind"), item.optLong("size", -1),
                    item.optString("title"), item.optString("form_level"), item.optString("subject"),
                    item.optString("category"), item.optString("mime_type"))
            }) { planned ->
                if (store.deviceId != device) throw kotlinx.coroutines.CancellationException("Enrollment changed")
                val item = downloads.getValue(planned.id)
                if (planned.kind == "app") {
                    val task = installs.getValue(planned.id).getString("id")
                    try {
                        check(withTimeoutOrNull(15 * 60_000L) {
                            install(item, task, api, store, hub, tasks); true
                        } == true) { "App attempt timed out. Later downloads continue; this app can retry." }
                        SetupProgress.reportSoon(applicationContext)
                        true
                    } catch (e: Exception) {
                        if (e is kotlinx.coroutines.CancellationException) throw e
                        DeviceLog.event(applicationContext, "error", "install", "setup_install_failed", e)
                        tasks.update(task, "waiting", error = Connectivity.message(e))
                        false
                    }
                } else {
                val target = hub.resourceFile(item)
                if (target.exists() && target.length() == item.getLong("size")) {
                    if (item.optString("kind") == "wallpaper") preview(item, target)
                    return@runPass true
                }
                val id = tasks.download(item.getString("id"), item.getString("title"), item.getLong("size"))
                val temp = File(target.path + ".part")
                try {
                    check(item.optLong("size", -1) >= 0) { "The catalogue file size is unknown." }
                    if (target.parentFile!!.usableSpace < (item.getLong("size") - temp.length()).coerceAtLeast(0) + 100L * 1024 * 1024)
                        error("Storage is nearly full. Free some space to continue this download.")
                    if (temp.length() > item.getLong("size")) temp.delete()
                    if (temp.length() != item.getLong("size")) check(withTimeoutOrNull(15 * 60_000L) {
                        api.download("/storage/v1/object/primesecure-hub/${item.getString("storage_path")}", temp, resume = true) { bytes, total, speed ->
                        tasks.update(id, "downloading", bytes, total, speed)
                        SetupProgress.reportSoon(applicationContext)
                        }; true
                    } == true) { "Transfer attempt timed out. Later downloads continue; this file will resume." }
                    check(temp.length() == item.getLong("size")) { "The download is incomplete. It will resume when connected." }
                    item.stringOrNull("sha256")?.let { expected ->
                        val hash = java.security.MessageDigest.getInstance("SHA-256")
                        temp.inputStream().use { input -> val buffer = ByteArray(65536); while (true) { val n = input.read(buffer); if (n < 0) break; hash.update(buffer, 0, n) } }
                        if (!hash.digest().joinToString("") { "%02x".format(it) }.equals(expected, true)) { temp.delete(); error("Damaged download. Please retry.") }
                    }
                    check(temp.renameTo(target)) { "Could not save the download." }
                    tasks.update(id, "done", target.length(), target.length())
                    if (item.optString("kind") == "wallpaper") preview(item, target)
                    SetupProgress.reportSoon(applicationContext)
                    true
                } catch (e: Exception) {
                    if (e is kotlinx.coroutines.CancellationException) throw e
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
            if (successful) hub.syncError = null
            SetupProgress.reportSoon(applicationContext, final = true)
            if (successful) Result.success() else Result.retry()
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            DeviceLog.event(applicationContext,"error","download","hub_sync_failed",e)
            hub.syncError = Connectivity.message(e); Result.retry()
        }
    }
    private suspend fun install(item: JSONObject, task: String, api: SupabaseApi, store: AgentStore, hub: HubStore, tasks: HubTasks) {
        val revision = api.rpc("device_sync_state").optLong("revision")
        val catalog = api.rpc("device_hub").put("_sync_revision", revision)
        hub.catalog = catalog
        check(catalog.optString("status", store.lastStatus) == "active") { "App installs require an active school device." }
        val fresh = catalog.optJSONArray("items") ?: org.json.JSONArray()
        val approved = (0 until fresh.length()).map { fresh.getJSONObject(it) }.find {
            it.optString("id") == item.optString("id") && it.optString("kind") == "app"
        } ?: error("This app is no longer approved for your school.")
        if (!runCatching { applicationContext.packageManager.getPackageInfo(approved.getString("package_name"), 0) }.isSuccess) {
            tasks.update(task, "syncing")
            AppInstaller(applicationContext, store).install(task, JSONObject().put("bucket", "primesecure-hub")
                .put("storage_path", approved.getString("storage_path")).put("hub_item_id", approved.getString("id"))
                .put("package", approved.getString("package_name")).put("sha256", approved.optString("sha256")), task)
        }
        tasks.update(task, "installed")
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
        fun schedule(context: Context,followUp:Boolean=false) {
            WorkManager.getInstance(context).enqueueUniqueWork("student-hub-sync", if(followUp) ExistingWorkPolicy.APPEND_OR_REPLACE else ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<HubSync>().setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
        }
    }
}
