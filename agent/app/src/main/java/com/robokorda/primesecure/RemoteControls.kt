package com.robokorda.primesecure

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.time.Instant

/** Only visible notices. Camera/projection never starts from a remote command. */
object RemoteControls {
    const val CHANNEL = "visible-school-controls"
    fun manager(context: Context): NotificationManager = context.getSystemService(NotificationManager::class.java)
    fun ensureVisible(context: Context) {
        val manager = manager(context)
        manager.createNotificationChannel(NotificationChannel(CHANNEL,"Visible school requests",NotificationManager.IMPORTANCE_HIGH))
        check(manager.areNotificationsEnabled() && manager.getNotificationChannel(CHANNEL).importance != NotificationManager.IMPORTANCE_NONE) {
            "Enable PrimeSecure's Visible school requests notifications before remote controls can run"
        }
    }
    fun notificationId(id: String) = ("capture:$id").hashCode()

    suspend fun execute(context: Context, id: String, type: String, payload: JSONObject): JSONObject = withContext(Dispatchers.Main) {
        require(RemoteControlRules.validId(id)) { "Invalid command reference" }
        require(payload.optBoolean("authorized") && payload.optBoolean("visible")) { "Visible school authorization required" }
        val expiry = Instant.parse(payload.getString("expires_at")).toEpochMilli()
        require(RemoteControlRules.validWindow(System.currentTimeMillis(),expiry,if(type=="alarm") 120_000L else 600_000L)) { "Remote request expired or device clock needs correction" }
        ensureVisible(context)
        val store = AgentStore(context)
        check(store.isEnrolled) { "Not enrolled" }
        val prefs = context.getSharedPreferences("visible-remote-controls",Context.MODE_PRIVATE)
        if(prefs.getString("device",null)!=store.deviceId) prefs.edit().clear().putString("device",store.deviceId).commit()
        val receiptKey="handled:$id"
        if(prefs.contains(receiptKey)) return@withContext JSONObject().put("state","already_requested").put("note","Request not replayed")
        if(type=="alarm") RemoteControlRules.alarmSeconds(payload.optInt("duration_seconds",15))
        else require(payload.optString("kind") in setOf("photo","screenshot")) { "Unsupported capture request" }
        // Persist BEFORE the side effect. A lost command acknowledgement must not ring/capture again.
        val receipts=prefs.edit()
        prefs.all.filter { (key,value)->key.startsWith("handled:") && value is Long && value<=System.currentTimeMillis() }.keys.forEach { receipts.remove(it) }
        check(receipts.putLong(receiptKey,expiry).commit()) { "Could not save remote request receipt" }
        if(type=="alarm") {
            RemoteAlarmService.start(context,id,payload.optInt("duration_seconds",15),payload.optString("reason"),expiry)
        } else {
            val open = RemoteCaptureActivity.intent(context,id,payload)
            val pending = PendingIntent.getActivity(context,id.hashCode(),open,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            manager(context).notify(notificationId(id),android.app.Notification.Builder(context,CHANNEL)
                .setSmallIcon(android.R.drawable.ic_menu_camera).setContentTitle("School requests a ${payload.optString("kind")}")
                .setContentText("Tap to review, allow or decline. Nothing is captured automatically.")
                .setContentIntent(pending).setVisibility(android.app.Notification.VISIBILITY_PRIVATE).setAutoCancel(true)
                .setTimeoutAfter((expiry-System.currentTimeMillis()).coerceAtLeast(1)).build())
            JSONObject().put("state","awaiting_student_consent").put("note","Visible request sent. No image has been captured")
        }
    }
}
