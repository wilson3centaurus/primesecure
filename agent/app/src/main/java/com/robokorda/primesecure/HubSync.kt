package com.robokorda.primesecure

import android.content.Context
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

class HubSync(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val store = AgentStore(applicationContext)
        if (!store.isEnrolled || store.lastStatus == "retired") return Result.success()
        StudentUiUpdates.check(applicationContext)
        val hub = HubStore(applicationContext); val tasks = HubTasks(applicationContext)
        val device = store.deviceId; val api = SupabaseApi(store)
        return try {
            hub.catalog = api.rpc("device_hub")
            if (store.deviceId != device) return Result.success()
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
            if (tasks.pending().any { it.optString("action") != "download" }) OfflineWorker.schedule(applicationContext)
            var failed = false
            val starter = InitialSetup.starterIds(hub.items())
            val defaultWallpaper = hub.catalog.optJSONObject("wallpaper")?.optString("id")
            val downloads = hub.items().filter { it.optString("kind") in setOf("resource", "wallpaper") }
                .sortedBy { when { it.optString("id") == defaultWallpaper -> 0; it.optString("id") in starter -> 1; else -> 2 } }
            for (item in downloads) {
                if (store.deviceId != device) return Result.success()
                val target = hub.resourceFile(item)
                if (target.exists() && target.length() == item.getLong("size")) { if (item.optString("kind") == "wallpaper") preview(item, target); continue }
                val id = tasks.download(item.getString("id"), item.getString("title"), item.getLong("size"))
                val temp = File(target.path + ".part")
                try {
                    if (target.parentFile!!.usableSpace < (item.getLong("size") - temp.length()).coerceAtLeast(0) + 100L * 1024 * 1024)
                        error("Storage is nearly full. Free some space to continue this download.")
                    if (temp.length() > item.getLong("size")) temp.delete()
                    if (temp.length() != item.getLong("size")) api.download("/storage/v1/object/primesecure-hub/${item.getString("storage_path")}", temp, resume = true) { bytes, total, speed ->
                        tasks.update(id, "downloading", bytes, total, speed)
                    }
                    check(temp.length() == item.getLong("size")) { "The download is incomplete. It will resume when connected." }
                    item.stringOrNull("sha256")?.let { expected ->
                        val hash = java.security.MessageDigest.getInstance("SHA-256")
                        temp.inputStream().use { input -> val buffer = ByteArray(65536); while (true) { val n = input.read(buffer); if (n < 0) break; hash.update(buffer, 0, n) } }
                        if (!hash.digest().joinToString("") { "%02x".format(it) }.equals(expected, true)) { temp.delete(); error("Damaged download. Please retry.") }
                    }
                    check(temp.renameTo(target)) { "Could not save the download." }
                    tasks.update(id, "done", target.length(), target.length())
                    if (item.optString("kind") == "wallpaper") preview(item, target)
                } catch (e: Exception) {
                    if (e is kotlinx.coroutines.CancellationException) throw e
                    failed = true; tasks.update(id, "waiting", error = Connectivity.message(e))
                    hub.syncError = Connectivity.message(e)
                }
            }
            // Retired items are no longer offered, even if downloaded; do not delete student files.
            val available = hub.items().map { it.getString("id") }.toSet()
            tasks.pending().filter { it.optString("key").startsWith("download:") && it.optJSONObject("payload")?.optString("item_id") !in available }.forEach { tasks.update(it.getString("id"), "superseded") }
            if (!failed) hub.syncError = null
            if (failed) Result.retry() else Result.success()
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            hub.syncError = Connectivity.message(e); Result.retry()
        }
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
        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniqueWork("student-hub-sync", ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<HubSync>().setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
        }
    }
}
