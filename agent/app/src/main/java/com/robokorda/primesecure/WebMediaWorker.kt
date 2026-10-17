package com.robokorda.primesecure

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.CookieManager
import androidx.work.*
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Media-only downloader: durable tasks, checked redirects, no APKs or HTML. */
class WebMediaWorker(context:Context,params:WorkerParameters):CoroutineWorker(context,params) {
    override suspend fun doWork():Result=withContext(Dispatchers.IO) {
        val id=inputData.getString("task") ?: return@withContext Result.success()
        if(runCatching { UUID.fromString(id) }.isFailure)return@withContext Result.failure()
        val tasks=HubTasks(applicationContext)
        val task=tasks.all().find { it.optString("id")==id&&it.optString("action")=="web_download" } ?: return@withContext Result.success()
        if(task.optString("status") in setOf("done","failed","superseded"))return@withContext Result.success()
        val store=AgentStore(applicationContext);val device=store.deviceId
        val payload=task.getJSONObject("payload")
        val tool=SchoolWebTools.configured(applicationContext,payload.optString("site")) ?: run { tasks.update(id,"failed",error="This download website is no longer available.");return@withContext Result.success() }
        val directory=File(applicationContext.cacheDir,"school-media").apply { mkdirs() }
        val part=File(directory,"$id.part");val info=File(directory,"$id.json")
        var lastDownloadUrl=payload.optString("url")
        fun permitted(url:String=payload.optString("url")) {
            check(store.isEnrolled&&store.deviceId==device&&store.lastStatus=="active") { "Downloads are available only on an active school device." }
            val current=SchoolWebTools.configured(applicationContext,tool.id) ?: error("This download website is no longer available.")
            check(ApprovedWebApps.rules(applicationContext).allows(current.startUrl)&&current.allowsDownload(payload.optString("url"),ApprovedWebApps.rules(applicationContext))&&current.allowsDownload(url,ApprovedWebApps.rules(applicationContext))) { "Your school has not approved this download URL." }
        }
        try {
            permitted();tasks.update(id,"downloading",bytes=part.length())
            val source=payload.getString("url");val school=ApprovedWebApps.rules(applicationContext)
            check(tool.allowsDownload(source,school)) { "This download host is not approved by your school." }
            val prior=runCatching { JSONObject(info.readText()) }.getOrNull()
            var offset=if(prior?.optString("source")==source&&prior.optString("validator").isNotBlank())part.length() else 0L
            if(offset==0L&&part.exists())part.delete()
            var url=source;var response:Response?=null
            for(hop in 0..5) {
                lastDownloadUrl=url
                permitted(url)
                val builder=Request.Builder().url(url).header("Referer",tool.startUrl)
                payload.optString("agent").takeIf { it.length in 1..500&&it.none { c->c<' '||c=='\u007f' } }?.let { builder.header("User-Agent",it) }
                CookieManager.getInstance().getCookie(url)?.let { builder.header("Cookie",it) }
                if(offset>0)builder.header("Range","bytes=$offset-").header("If-Range",prior!!.getString("validator"))
                val next=client.newCall(builder.build()).execute()
                if(next.code in setOf(301,302,303,307,308)) {
                    val location=next.header("Location");val resolved=location?.let { next.request.url.resolve(it) }?.toString();next.close()
                    check(hop<5&&resolved!=null) { "This download has too many redirects." };url=resolved;continue
                }
                response=next;break
            }
            val result=response ?: error("The download did not return a file.")
            val format=result.use { res ->
                if(res.code==429||res.code>=500)throw IOException("The download service is busy. It will retry.")
                if(res.code==416) { part.delete();info.delete();throw IOException("The download changed. It will restart when connected.") }
                check(res.isSuccessful) { "The website could not provide this file. Open it again and use its download button." }
                if(offset>0&&res.code!=206)offset=0
                if(res.code==206)check(res.header("Content-Range")?.startsWith("bytes $offset-")==true) { "The website returned an invalid partial download." }
                val body=res.body ?: error("This download is empty.")
                val total=res.header("Content-Range")?.substringAfterLast('/')?.toLongOrNull() ?: body.contentLength().takeIf { it>=0 }?.plus(offset) ?: 0L
                val limit=if(tool.imagesOnly)25_000_000L else 250_000_000L
                check(total<=limit&&directory.usableSpace>maxOf(total-offset,0)+40_000_000L) { "This file is too large or your Primebook needs more free space." }
                val validator=res.header("ETag")?.takeUnless { it.startsWith("W/") } ?: res.header("Last-Modified") ?: ""
                info.writeText(JSONObject().put("source",source).put("validator",validator).toString())
                body.byteStream().buffered().use { input ->
                    val prefix=ByteArray(32);var count=0
                    while(count<prefix.size) { val n=input.read(prefix,count,prefix.size-count);if(n<0)break;count+=n }
                    val signature=if(offset>0)part.inputStream().use { old->ByteArray(32).also { old.read(it) } } else prefix.copyOf(count)
                    val detected=WebMediaRules.identify(signature,res.header("Content-Type") ?: "",tool.imagesOnly)
                        ?: error("This is not a supported ${if(tool.imagesOnly)"image" else "music or video"} file. Use the site's actual download button.")
                    var bytes=offset;var lastBytes=bytes;var lastUpdate=System.currentTimeMillis()
                    java.io.FileOutputStream(part,offset>0).use { output ->
                        if(count>0) { output.write(prefix,0,count);bytes+=count }
                        val buffer=ByteArray(64*1024)
                        while(true) {
                            currentCoroutineContext().ensureActive();val n=input.read(buffer);if(n<0)break
                            bytes+=n;check(bytes<=limit) { "This file exceeds the school download size limit." };output.write(buffer,0,n)
                            val now=System.currentTimeMillis()
                            if(now-lastUpdate>=750) {
                                permitted(url);check(directory.usableSpace>20_000_000L) { "Your Primebook needs more free space to finish this download." };tasks.update(id,"downloading",bytes,total,(bytes-lastBytes)*1000/maxOf(1,now-lastUpdate));lastBytes=bytes;lastUpdate=now
                            }
                        }
                    }
                    if(total>0&&bytes!=total)throw IOException("The download was interrupted. It will resume when connected.")
                    check(bytes>0) { "This download is empty." }
                    detected
                }
            }
            permitted(url);currentCoroutineContext().ensureActive()
            if(format.mime.startsWith("image/")) {
                val bounds=android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds=true }
                android.graphics.BitmapFactory.decodeFile(part.path,bounds)
                check(bounds.outWidth>0&&bounds.outHeight>0) { "This image could not be read." }
            }
            try { saveMedia(part,WebMediaRules.safeName(payload.optString("name","School download"),format.extension),format.mime) }
            catch(e:IOException) { throw IllegalStateException("This file could not be saved. Check your storage space or contact Support.",e) }
            catch(e:SecurityException) { throw IllegalStateException("Storage permission needs attention. Contact Support.",e) }
            tasks.update(id,"done",bytes=part.length(),total=part.length());part.delete();info.delete()
            File(applicationContext.filesDir,"file-inventory.json").delete()
            TelemetryWorker.schedule(applicationContext)
            Result.success()
        } catch(e:CancellationException) { throw e }
        catch(e:Exception) {
            if(e is IOException) { tasks.update(id,"waiting",bytes=part.length(),error=Connectivity.message(e));Result.retry() }
            else {
                part.delete();info.delete();tasks.update(id,"failed",error=e.message ?: "This download could not be saved.")
                val uri=runCatching { java.net.URI(lastDownloadUrl) }.getOrNull()
                val clean=runCatching { java.net.URI(uri?.scheme,null,uri?.host,uri?.port ?: -1,uri?.path,null,null).toString().take(500) }.getOrDefault("")
                DeviceLog.event(applicationContext,"info","download","school_web_download_blocked",details=JSONObject().put("site",tool.id).put("host",uri?.host ?: "").put("url_without_query",clean))
                Result.success()
            }
        }
    }
    private fun saveMedia(file:File,name:String,mime:String) {
        val resolver=applicationContext.contentResolver
        if(Build.VERSION.SDK_INT>=29) {
            val (collection,folder)=when {
                mime.startsWith("image/")->MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to Environment.DIRECTORY_PICTURES
                mime.startsWith("audio/")->MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to Environment.DIRECTORY_MUSIC
                else->MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to Environment.DIRECTORY_MOVIES
            }
            val values=ContentValues().apply { put(MediaStore.MediaColumns.DISPLAY_NAME,name);put(MediaStore.MediaColumns.MIME_TYPE,mime);put(MediaStore.MediaColumns.RELATIVE_PATH,"$folder/PrimeSecure");put(MediaStore.MediaColumns.IS_PENDING,1) }
            val uri=resolver.insert(collection,values) ?: error("Could not create the media file.")
            try {
                resolver.openOutputStream(uri)?.use { out->file.inputStream().use { it.copyTo(out) } } ?: error("Could not save the media file.")
                values.clear();values.put(MediaStore.MediaColumns.IS_PENDING,0);check(resolver.update(uri,values,null,null)==1)
            } catch(e:Exception) { resolver.delete(uri,null,null);throw e }
        } else {
            @Suppress("DEPRECATION")
            val directory=Environment.getExternalStoragePublicDirectory(when { mime.startsWith("image/")->Environment.DIRECTORY_PICTURES;mime.startsWith("audio/")->Environment.DIRECTORY_MUSIC;else->Environment.DIRECTORY_MOVIES }).resolve("PrimeSecure").apply { mkdirs() }
            val dest=File.createTempFile(name.substringBeforeLast('.').take(50)+"-","."+name.substringAfterLast('.'),directory)
            try { file.copyTo(dest,overwrite=true);android.media.MediaScannerConnection.scanFile(applicationContext,arrayOf(dest.path),arrayOf(mime),null) }
            catch(e:Exception) { dest.delete();throw e }
        }
    }
    companion object {
        private val client=OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).connectTimeout(20,TimeUnit.SECONDS).readTimeout(30,TimeUnit.SECONDS).build()
        internal fun enqueue(context:Context,tool:SchoolWebTool,url:String,name:String,agent:String):String {
            check(ApprovedWebApps.rules(context).allows(tool.startUrl)&&tool.allowsDownload(url,ApprovedWebApps.rules(context))) { "This download is not approved by your school." }
            check(url.length<=8000)
            val id=HubTasks(context).enqueue("web_download",JSONObject().put("site",tool.id).put("url",url).put("name",name.take(180)).put("agent",agent.take(500)),name.take(120).ifBlank { tool.title },"web:${tool.id}:$url")
            schedule(context,id);return id
        }
        fun schedule(context:Context,id:String) {
            WorkManager.getInstance(context).enqueueUniqueWork("school-media-$id",ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<WebMediaWorker>().setInputData(workDataOf("task" to id)).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).setBackoffCriteria(BackoffPolicy.LINEAR,10,TimeUnit.SECONDS).build())
        }
    }
}
