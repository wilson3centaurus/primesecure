package com.robokorda.primesecure

import android.content.Context
import org.json.JSONObject
import java.io.File

internal object PrimeMediaDownloads {
    suspend fun download(context:Context,payload:JSONObject,task:String) {
        val store=AgentStore(context);val device=store.deviceId;val hub=HubStore(context);val api=SupabaseApi(store);val tasks=HubTasks(context)
        val revision=api.rpc("device_sync_state").optLong("revision")
        val fresh=api.rpc("device_hub").put("_sync_revision",revision);hub.catalog=fresh
        check(store.lastStatus=="active"&&fresh.optJSONObject("prime_media")?.optBoolean("enabled")==true) { "Prime Media is no longer available for this device." }
        val item=hub.items().find { it.optString("id")==payload.optString("item_id")&&it.optString("kind")=="media" } ?: error("This file is no longer approved by your school.")
        val size=item.getLong("size");check(size in 1..250_000_000)
        val target=hub.resourceFile(item);val part=File(target.path+".part")
        if(target.exists()&&target.length()==size) { tasks.update(task,"done",size,size);return }
        if(part.length()>size)part.delete()
        check(target.parentFile!!.usableSpace>(size-part.length()).coerceAtLeast(0)+100_000_000) { "Storage is nearly full. Free space and retry." }
        api.download("/storage/v1/object/primesecure-hub/${item.getString("storage_path")}",part,resume=true) { bytes,total,speed ->
            check(AgentStore(context).deviceId==device&&AgentStore(context).lastStatus=="active") { "School enrollment or device access changed." }
            check(bytes<=size&&total<=size) { "This download is larger than expected." };tasks.update(task,"downloading",bytes,size,speed)
        }
        check(part.length()==size) { "Download is incomplete. It will resume when connected." }
        val prefix=part.inputStream().use { input->ByteArray(32).also { input.read(it) } }
        check(WebMediaRules.identify(prefix,item.optString("mime_type"),false)!=null) { "This file is not a supported music or video file." }
        val current=api.rpc("device_hub");val entries=current.optJSONArray("items") ?: org.json.JSONArray()
        check(AgentStore(context).deviceId==device&&AgentStore(context).lastStatus=="active"&&current.optJSONObject("prime_media")?.optBoolean("enabled")==true&&(0 until entries.length()).any { entries.getJSONObject(it).optString("id")==item.getString("id")&&entries.getJSONObject(it).optString("storage_path")==item.getString("storage_path") }) { "This file was withdrawn before the download finished." }
        check(part.renameTo(target)) { "Could not save this file." };tasks.update(task,"done",size,size)
    }
}
