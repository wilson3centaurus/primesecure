package com.robokorda.primesecure

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import java.io.File
import java.util.concurrent.TimeUnit

/** Fixed public image host, no device token/cookies; only IDs already shown to this student. */
internal object PrimeMediaCovers {
    private val http=OkHttpClient.Builder().followRedirects(false).connectTimeout(5,TimeUnit.SECONDS).readTimeout(5,TimeUnit.SECONDS).callTimeout(8,TimeUnit.SECONDS).build()
    fun read(context:Context,id:String):ByteArray?=runCatching {
        if(!PrimeMediaRules.videoId(id))return null
        val store=AgentStore(context);val owner=store.deviceId
        if(!store.isEnrolled||store.lastStatus!="active")return null
        val cfg=HubStore(context).catalog.optJSONObject("prime_media") ?: return null
        if(!cfg.optBoolean("enabled"))return null
        val videos=cfg.optJSONArray("videos") ?: JSONArray()
        if(!(0 until videos.length()).any { videos.getJSONObject(it).optString("video_id")==id }&&!PrimeMediaClient.knownCover(owner,id,cfg))return null
        val dir=File(context.cacheDir,"prime-media-covers").apply { mkdirs() };val file=File(dir,"$id.jpg")
        if(file.exists()&&file.length() in 1..250_000) { file.setLastModified(System.currentTimeMillis());return file.readBytes() }
        val data=http.newCall(Request.Builder().url("https://i.ytimg.com/vi/$id/mqdefault.jpg").build()).execute().use { response ->
            if(!response.isSuccessful||response.header("Content-Type")?.substringBefore(';')!="image/jpeg")return null
            val input=response.body?.byteStream() ?: return null
            input.use { stream -> val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192);while(true){val n=stream.read(buffer);if(n<0)break;if(out.size()+n>250_000)return null;out.write(buffer,0,n)};out.toByteArray() }
        }
        if(data.size<3||data[0].toInt() and 255!=255||data[1].toInt() and 255!=216||AgentStore(context).deviceId!=owner)return null
        synchronized(this) {
            file.writeBytes(data)
            dir.listFiles()?.sortedByDescending { it.lastModified() }?.drop(60)?.forEach { it.delete() }
        }
        data
    }.getOrNull()
}
