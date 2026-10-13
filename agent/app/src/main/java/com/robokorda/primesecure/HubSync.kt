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
        val hub = HubStore(applicationContext)
        val enrolledDevice = store.deviceId
        val api = SupabaseApi(store)
        return try {
            val catalog = api.rpc("device_hub")
            if (store.deviceId != enrolledDevice) return Result.success()
            hub.catalog = catalog
            val history=api.rpc("device_message_history")
            val messages = history.optJSONArray("messages")
            hub.catalog = JSONObject(hub.catalog.toString()).put("replies",history.optJSONArray("replies"))
            if (messages != null) for (i in 0 until messages.length()) {
                val m = messages.getJSONObject(i)
                hub.saveMessage(m.getString("id"), m.getJSONObject("payload"), m.getString("created_at"))
                if (!m.isNull("acknowledged_at")) hub.acknowledge(m.getString("id"), true)
                if (!m.isNull("seen_at")) hub.seen(m.getString("id"),true)
            }
            for (m in hub.messages().filter { it.optBoolean("acknowledged") && !it.optBoolean("ack_synced") }) {
                api.rpc("device_ack_message", JSONObject().put("p_command_id", m.getString("id")))
                hub.acknowledge(m.getString("id"), true)
            }
            withContext(Dispatchers.Main) { MessageActivity.showPending(applicationContext) }
            MessageAckWorker.schedule(applicationContext)
            for(item in hub.items().filter { it.optString("kind")=="wallpaper" }) runCatching {
                val preview=File(applicationContext.filesDir,"hub-preview-${item.getString("id")}.jpg")
                if(!preview.exists()) {
                    val temp=File(applicationContext.cacheDir,"wallpaper-preview")
                    try {
                        api.download("/storage/v1/object/primesecure-hub/${item.getString("storage_path")}",temp)
                        val options=android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds=true }
                        android.graphics.BitmapFactory.decodeFile(temp.path,options)
                        options.inJustDecodeBounds=false; options.inSampleSize=maxOf(1,maxOf(options.outWidth,options.outHeight)/400)
                        android.graphics.BitmapFactory.decodeFile(temp.path,options)?.let { bitmap ->
                            preview.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG,70,it) }; bitmap.recycle()
                        }
                    } finally { temp.delete() }
                }
            }
            val viewers=hub.catalog.optJSONObject("management")?.optJSONObject("viewer_packages")
            val viewerPackages=viewers?.keys()?.asSequence()?.map { viewers.optString(it) }?.toSet() ?: emptySet()
            if (store.lastStatus == "active") for (item in hub.items().filter { it.getString("kind") == "app" && (it.optBoolean("preinstall") || it.optString("package_name") in viewerPackages) }) {
                val installed = runCatching { applicationContext.packageManager.getPackageInfo(item.getString("package_name"), 0) }.isSuccess
                if (!installed) api.rpc("device_hub_action", JSONObject().put("p_action", "install").put("p_item_id", item.getString("id")))
            }
            var downloadError: String? = null
            for (item in hub.items().filter { it.getString("kind") == "resource" }) {
                if (store.deviceId != enrolledDevice) return Result.success()
                val target = hub.resourceFile(item)
                if (target.exists() && target.length() == item.getLong("size")) continue
                if (target.parentFile!!.usableSpace < item.getLong("size") + 100L * 1024 * 1024) {
                    hub.syncError = "Storage nearly full. Waiting for space to download ${item.getString("title")}."
                    return Result.retry()
                }
                val temp = File(target.path + ".part")
                try {
                    if (temp.length() > item.getLong("size")) temp.delete()
                    if (temp.length() != item.getLong("size")) api.download("/storage/v1/object/primesecure-hub/${item.getString("storage_path")}", temp, resume = true)
                    check(temp.length() == item.getLong("size")) { "Incomplete download" }
                    check(temp.renameTo(target)) { "Could not save download" }
                } catch (e: Exception) {
                    if (e is kotlinx.coroutines.CancellationException) throw e
                    downloadError = "${item.getString("title")}: ${e.message}"
                }
            }
            hub.syncError = downloadError
            if (downloadError == null) Result.success() else Result.retry()
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            hub.syncError = e.message ?: "Waiting for connection"
            Result.retry()
        }
    }
    companion object {
        fun schedule(context: Context) {
            val request = OneTimeWorkRequestBuilder<HubSync>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
            WorkManager.getInstance(context).enqueueUniqueWork("student-hub-sync", ExistingWorkPolicy.KEEP, request)
        }
    }
}
