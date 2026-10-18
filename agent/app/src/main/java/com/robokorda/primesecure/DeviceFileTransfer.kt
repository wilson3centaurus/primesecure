package com.robokorda.primesecure

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Environment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit

/** retrieve_file commands carry ONLY request_id. Server tickets bind path/device/school. */
class DeviceFileTransfer(private val context:Context,private val store:AgentStore) {
    suspend fun upload(payload:JSONObject):JSONObject = withContext(Dispatchers.IO) {
        require(store.isEnrolled && store.lastStatus!="retired") { "Device not enrolled" }
        val device=store.deviceId
        val requestId=UUID.fromString(payload.getString("request_id")).toString()
        val args=JSONObject().put("p_request_id",requestId)
        val api=SupabaseApi(store)
        val ticket=api.rpc("device_file_transfer_ticket",args)
        if(ticket.optBoolean("ready"))return@withContext JSONObject().put("request_id",requestId).put("ready",true)
        val path=ticket.getString("path")
        require(DeviceFileTransferRules.validPath(path)) { "Protected or invalid shared-storage path" }
        val file=FileManager(store,context).checkedFile(path)
        // checkedFile resolves symlinks: validate the target too, not merely the requested name.
        @Suppress("DEPRECATION") val root=Environment.getExternalStorageDirectory().canonicalFile
        val canonicalPath=if(file.path.startsWith(root.path+File.separator))file.toRelativeString(root) else {
            val volume=File("/storage").listFiles()?.firstOrNull { it.name.matches(Regex("[0-9a-fA-F]{4}-[0-9a-fA-F]{4}")) && file.path.startsWith(it.canonicalPath+File.separator) }
                ?: error("File outside shared storage")
            "@usb/${volume.name}/${file.toRelativeString(volume.canonicalFile)}"
        }
        require(DeviceFileTransferRules.validPath(canonicalPath)) { "Protected file target" }
        val size=ticket.getLong("size"); val modified=ticket.getLong("modified")
        fun validate() {
            require(store.deviceId==device && store.isEnrolled && store.lastStatus!="retired") { "Device enrollment changed" }
            require(file.isFile) { "File no longer available" }
            DeviceFileTransferRules.validateMetadata(size,modified,file.length(),file.lastModified())
        }
        validate()
        val destination=ticket.getString("storage_path")
        require(ticket.getString("bucket")=="device-file-originals" && destination.split('/').let { it.size==4 && it[1]==device && it[2]==requestId && it[3]=="original" }) { "Invalid transfer destination" }
        val manager=context.getSystemService(NotificationManager::class.java)
        val channel="device-file-transfers"
        manager.createNotificationChannel(NotificationChannel(channel,"School file requests",NotificationManager.IMPORTANCE_DEFAULT))
        require(manager.areNotificationsEnabled() && manager.getNotificationChannel(channel)?.importance!=NotificationManager.IMPORTANCE_NONE) { "Enable visible school file request notifications first" }
        val notificationId=810_000+(requestId.hashCode() and 0xffff)
        fun notify(text:String,ongoing:Boolean) {
            manager.notify(notificationId,Notification.Builder(context,channel).setSmallIcon(android.R.drawable.stat_sys_upload)
                .setContentTitle("School requested ${file.name}").setContentText(text).setOngoing(ongoing)
                .setVisibility(Notification.VISIBILITY_PRIVATE).setAutoCancel(!ongoing).build())
        }
        notify("Sending this shared-storage original to your authorized school administrator.",true)
        try {
            if(!ticket.optBoolean("uploaded")) {
                suspend fun send():Int {
                    val request=Request.Builder().url(store.serverUrl.trimEnd('/')+"/storage/v1/object/device-file-originals/"+destination)
                        .header("apikey",store.anonKey).header("Authorization","Bearer ${api.accessToken()}")
                        .header("x-upsert","false").post(file.asRequestBody("application/octet-stream".toMediaType())).build()
                    return uploadHttp.newCall(request).execute().use { response->
                        if(!response.isSuccessful && response.code!=401)throw ApiException(response.code,"Original upload failed")
                        response.code
                    }
                }
                if(send()==401) { store.accessToken=null; validate(); if(send()==401)throw ApiException(401,"Sign-in expired during original upload") }
            }
            validate()
            val result=api.rpc("device_file_transfer_complete",JSONObject(args.toString()).put("p_size",size).put("p_modified",modified))
            notify("Requested file sent. The school's temporary copy expires within 24 hours.",false)
            result
        } catch(e:Exception) {
            notify("File request did not complete. Your school can check its request status.",false)
            throw e
        }
    }
    companion object {
        private val uploadHttp=SupabaseApi.http.newBuilder().callTimeout(0,TimeUnit.SECONDS)
            .writeTimeout(60,TimeUnit.SECONDS).readTimeout(60,TimeUnit.SECONDS).build()
    }
}
