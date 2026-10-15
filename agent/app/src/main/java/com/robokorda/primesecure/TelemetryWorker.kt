package com.robokorda.primesecure

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Environment
import android.webkit.MimeTypeMap
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.TimeUnit

/** Bounded shared-storage metadata cache; no app-private or system directories. */
class TelemetryWorker(context:Context,params:WorkerParameters):CoroutineWorker(context,params) {
    override suspend fun doWork():Result = withContext(Dispatchers.IO) {
        val store=AgentStore(applicationContext)
        if(!store.isEnrolled || store.lastStatus=="retired") return@withContext Result.success()
        val device=store.deviceId; val api=SupabaseApi(store)
        val prefs=applicationContext.getSharedPreferences("device-telemetry",Context.MODE_PRIVATE)
        val now=System.currentTimeMillis()
        val snapshotDue=SchoolControlRules.due(now,prefs.getLong("last:$device",0),4*60_000L)
        try {
            if(snapshotDue && FileManager.hasAccess()) {
                val snapshot=snapshot(applicationContext)
                if(store.deviceId!=device) return@withContext Result.success()
                val digest=java.security.MessageDigest.getInstance("SHA-256").digest(snapshot.getJSONArray("entries").toString().toByteArray()).joinToString("") { "%02x".format(it) }
                if(prefs.getString("hash:$device",null)==digest) api.rpc("device_file_snapshot_touch")
                else { api.rpc("device_file_snapshot",JSONObject().put("p_snapshot",snapshot)); prefs.edit().putString("hash:$device",digest).apply() }
                File(applicationContext.filesDir,"file-inventory.json").writeText(snapshot.toString())
            }
            runCatching { Locator(applicationContext,store).locateScheduled() }
            if(snapshotDue)prefs.edit().putLong("last:$device",System.currentTimeMillis()).apply()
            UsageReporter.report(applicationContext)
            Result.success()
        } catch(e:Exception) { if(e is kotlinx.coroutines.CancellationException) throw e; Result.retry() }
    }
    companion object {
        fun schedule(context:Context) {
            val online=Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            WorkManager.getInstance(context).enqueueUniqueWork("device-telemetry-now",ExistingWorkPolicy.KEEP,OneTimeWorkRequestBuilder<TelemetryWorker>().setConstraints(online).build())
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("device-telemetry",ExistingPeriodicWorkPolicy.KEEP,PeriodicWorkRequestBuilder<TelemetryWorker>(15,TimeUnit.MINUTES).setConstraints(online).build())
        }
        @Suppress("DEPRECATION")
        fun snapshot(context:Context):JSONObject {
            val root=Environment.getExternalStorageDirectory().canonicalFile
            val roots=mutableMapOf(root to "")
            if(HubStore(context).catalog.optJSONObject("management")?.optBoolean("block_usb_storage")!=true)
                File("/storage").listFiles()?.filter { it.isDirectory && it.name.matches(Regex("[0-9a-fA-F]{4}-[0-9a-fA-F]{4}")) }?.forEach { roots[it.canonicalFile]="@usb/${it.name}" }
            val entries=JSONArray(); val queue=java.util.ArrayDeque<Pair<File,Int>>(); roots.keys.forEach { queue.add(it to 0) }
            roots.filterValues { it.isNotEmpty() }.forEach { (volume,path)->entries.put(JSONObject().put("path",path).put("name","Removable drive ${volume.name}").put("parent","").put("dir",true).put("size",0).put("modified",volume.lastModified()).put("kind","folder")) }
            val prior=runCatching { JSONObject(File(context.filesDir,"file-inventory.json").readText()).getJSONArray("entries") }.getOrNull()
            val priorEntries=prior?.let { a->(0 until a.length()).map { a.getJSONObject(it) }.associateBy { it.optString("path") } } ?: emptyMap()
            var thumbnails=0; var payloadBytes=0; var inaccessible=0; var truncated=false
            while(queue.isNotEmpty() && entries.length()<5000) {
                val (dir,depth)=queue.removeFirst(); val children=dir.listFiles()
                val base=roots.entries.find { dir==it.key || dir.path.startsWith(it.key.path+File.separator) } ?: continue
                fun relative(f:File)=listOf(base.value,f.toRelativeString(base.key)).filter { it.isNotEmpty() }.joinToString("/")
                if(children==null){inaccessible++;continue}
                for(f in children.sortedBy { it.name.lowercase() }) {
                    if(entries.length()>=5000){truncated=true;break}
                    val canonical=runCatching { f.canonicalFile }.getOrNull() ?: continue
                    if(!canonical.path.startsWith(base.key.path+File.separator) || canonical!=f.absoluteFile) continue
                    val path=relative(canonical)
                    if(canonical.toRelativeString(base.key) in listOf("Android/data","Android/obb")) { inaccessible++;continue }
                    val mime=MimeTypeMap.getSingleton().getMimeTypeFromExtension(f.extension.lowercase()) ?: "application/octet-stream"
                    val kind=when { f.isDirectory->"folder"; mime.startsWith("image/")->"image"; mime.startsWith("video/")->"video"; mime.startsWith("audio/")->"audio"; else->"document" }
                    val entry=JSONObject().put("path",path).put("name",f.name).put("parent",relative(dir)).put("dir",f.isDirectory)
                        .put("size",if(f.isFile) f.length() else 0).put("modified",f.lastModified()).put("mime",mime).put("kind",kind)
                    if(kind=="image" && thumbnails<24 && payloadBytes<1000000) runCatching {
                        val cached=priorEntries[path]
                        if(cached!=null && cached.optLong("size")==f.length() && cached.optLong("modified")==f.lastModified() && cached.has("thumbnail")) {
                            entry.put("thumbnail",cached.getString("thumbnail")); thumbnails++
                        } else {
                        val options=BitmapFactory.Options().apply { inJustDecodeBounds=true }; BitmapFactory.decodeFile(f.path,options)
                        if(options.outWidth>0 && options.outHeight>0) {
                            options.inJustDecodeBounds=false; options.inSampleSize=maxOf(1,maxOf(options.outWidth,options.outHeight)/120)
                            val decoded=BitmapFactory.decodeFile(f.path,options)
                            if(decoded!=null) {
                                val scale=120.0/maxOf(decoded.width,decoded.height)
                                val small=Bitmap.createScaledBitmap(decoded,(decoded.width*scale).toInt().coerceAtLeast(1),(decoded.height*scale).toInt().coerceAtLeast(1),true)
                                val out=ByteArrayOutputStream(); small.compress(Bitmap.CompressFormat.JPEG,45,out); val bytes=out.toByteArray()
                                if(bytes.size<25000) { entry.put("thumbnail","data:image/jpeg;base64,"+android.util.Base64.encodeToString(bytes,android.util.Base64.NO_WRAP)); thumbnails++ }
                                if(small!==decoded)small.recycle(); decoded.recycle()
                            }
                        }
                        }
                    }
                    payloadBytes+=entry.toString().toByteArray(Charsets.UTF_8).size
                    if(payloadBytes>1750000){truncated=true;queue.clear();break}
                    entries.put(entry)
                    if(f.isDirectory && depth<12)queue.add(canonical to depth+1) else if(f.isDirectory)truncated=true
                }
            }
            return JSONObject().put("entries",entries).put("truncated",truncated || queue.isNotEmpty()).put("inaccessible_folders",inaccessible)
                .put("root","/sdcard").put("free_bytes",root.usableSpace).put("total_bytes",root.totalSpace)
        }
    }
}
