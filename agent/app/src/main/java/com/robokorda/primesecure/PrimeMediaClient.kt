package com.robokorda.primesecure

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/** Search credentials stay server-side. Search-result playback leases are memory-only. */
internal object PrimeMediaClient {
    private var device:String?=null
    private var policy=""
    private var expires=0L
    private var results=JSONArray()
    private var queryKey=""
    private fun signature(cfg:JSONObject)=JSONObject().put("enabled",cfg.optBoolean("enabled")).put("search",cfg.optBoolean("youtube_search")).put("channels",cfg.optJSONArray("channels")).toString()
    fun knownCover(owner:String?,id:String,cfg:JSONObject):Boolean=synchronized(this) {
        cfg.optBoolean("youtube_search")&&device==owner&&policy==signature(cfg)&&expires>System.currentTimeMillis()&&(0 until results.length()).any { results.getJSONObject(it).optString("video_id")==id }
    }
    suspend fun search(context:Context,query:String,channel:String):JSONArray=withContext(Dispatchers.IO) {
        require(query.length in 2..120)
        val store=AgentStore(context);val owner=store.deviceId;check(store.lastStatus=="active") { "Your school has restricted this device." }
        val api=SupabaseApi(store);val cfg=api.rpc("device_prime_media")
        check(cfg.optBoolean("enabled")&&cfg.optBoolean("youtube_search")) { "YouTube search is not enabled by your school. Browse your school collection." }
        val key="$query|$channel";val sig=signature(cfg)
        synchronized(this@PrimeMediaClient) { if(device==store.deviceId&&policy==sig&&key==queryKey&&expires-55*60_000>System.currentTimeMillis())return@withContext JSONArray(results.toString()) }
        val request=Request.Builder().url("https://primesecure-beta.vercel.app/api/prime-media/search")
            .header("Authorization","Bearer ${api.accessToken()}").post(JSONObject().put("query",query).put("channel",channel).toString().toRequestBody("application/json".toMediaType())).build()
        val rows=SupabaseApi.http.newCall(request).execute().use { response ->
            val body=JSONObject(response.body?.string() ?: "{}")
            check(response.isSuccessful) { body.optString("error","Search is unavailable. Try again later.") }
            body.optJSONArray("items") ?: JSONArray()
        }
        check(AgentStore(context).deviceId==owner) { "School enrollment changed. Reopen PrimeSecure." }
        synchronized(this@PrimeMediaClient) { device=owner;policy=sig;queryKey=key;expires=System.currentTimeMillis()+60*60_000;results=rows }
        rows
    }
    suspend fun approved(context:Context,id:String):Boolean {
        if(!PrimeMediaRules.videoId(id))return false
        val store=AgentStore(context);if(!store.isEnrolled||store.lastStatus!="active")return false
        val cfg=SupabaseApi(store).rpc("device_prime_media");if(!cfg.optBoolean("enabled"))return false
        val videos=cfg.optJSONArray("videos") ?: JSONArray()
        if((0 until videos.length()).any { videos.getJSONObject(it).optString("video_id")==id })return true
        return synchronized(this) { cfg.optBoolean("youtube_search")&&device==store.deviceId&&policy==signature(cfg)&&expires>System.currentTimeMillis()&&(0 until results.length()).any { results.getJSONObject(it).optString("video_id")==id } }
    }
}
