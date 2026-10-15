package com.robokorda.primesecure

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** Visible school lost-device lock. Does not change the Android password or use camera/microphone. */
object LostMode {
    private var alarm: MediaPlayer? = null
    private fun prefs(context: Context) = context.getSharedPreferences("lost-mode", Context.MODE_PRIVATE).also {
        val device = AgentStore(context).deviceId
        if (it.getString("device", null) != device) it.edit().clear().putString("device", device).commit()
    }
    fun active(context: Context) = prefs(context).getBoolean("active", false)
    fun message(context: Context): String? = prefs(context).getString("message", null)

    fun observe(context: Context, response: JSONObject) {
        if (!response.has("lost_mode")) return // Older servers must not clear a cached school lock.
        val active = response.optBoolean("lost_mode")
        prefs(context).edit().putBoolean("active", active).putBoolean("alarm", active && response.optBoolean("lost_alarm"))
            .putString("message", response.stringOrNull("lost_message")).commit()
    }

    suspend fun applyAlarm(context: Context) = withContext(Dispatchers.Main) {
        val wanted = active(context) && prefs(context).getBoolean("alarm", false)
        if (!wanted) { alarm?.release(); alarm = null; return@withContext }
        if (alarm != null) return@withContext
        runCatching {
            val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            alarm = MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                setDataSource(context, sound)
                isLooping = true
                setOnErrorListener { player, _, _ -> player.release(); alarm = null; true }
                setOnPreparedListener { it.start() }
                prepareAsync()
            }
        }.onFailure { alarm?.release(); alarm = null; DeviceLog.event(context, "error", "command", "lost_alarm_failed", it) }
    }

    suspend fun recover(context: Context, code: String) {
        require(code.matches(Regex("[0-9a-fA-F]{16}"))) { "Enter the 16-character recovery code from your administrator." }
        check(Connectivity.online(context)) { "Connect to the internet to verify this recovery code." }
        SupabaseApi(AgentStore(context)).rpc("device_recover_lost", JSONObject().put("p_code", code.uppercase()))
        CheckInWorker.checkIn(context)
    }

    suspend fun clear(context: Context) { prefs(context).edit().clear().commit(); applyAlarm(context) }
}
