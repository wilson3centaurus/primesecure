package com.robokorda.primesecure

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

/** An audible, stoppable school alert, NOT lost mode. Never changes DND policy. */
class RemoteAlarmService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var command: String? = null
    private var stopping = false
    private val prefs by lazy { getSharedPreferences("remote-alarm-volume",MODE_PRIVATE) }
    private val audio by lazy { getSystemService(AudioManager::class.java) }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() { super.onCreate(); restoreVolume() }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if(intent==null || intent.action==STOP) { stopSelf(); return START_NOT_STICKY }
        val id = intent.getStringExtra("command") ?: run { stopSelf();return START_NOT_STICKY }
        if(command!=null) {
            pending[id]?.completeExceptionally(IllegalStateException("A school alarm is already active"))
            return START_STICKY // A repeated/new intent cannot extend a running alert.
        }
        try {
            check(AgentStore(this).isEnrolled)
            RemoteControls.ensureVisible(this)
            val seconds = RemoteControlRules.alarmSeconds(intent.getIntExtra("seconds",15))
            check(RemoteControlRules.validWindow(System.currentTimeMillis(),intent.getLongExtra("expires",0),120_000)) { "Alarm expired" }
            command=id
            val stop=PendingIntent.getService(this,ID,Intent(this,RemoteAlarmService::class.java).setAction(STOP),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val open=PendingIntent.getActivity(this,ID,Intent(this,RemoteAlarmActivity::class.java).putExtra("reason",intent.getStringExtra("reason")),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            startForeground(ID,Notification.Builder(this,RemoteControls.CHANNEL).setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle("School high-alert alarm").setContentText("Stops within $seconds seconds. Tap Stop alarm at any time.")
                .setContentIntent(open).addAction(Notification.Action.Builder(null,"Stop alarm",stop).build())
                .setCategory(Notification.CATEGORY_ALARM).setVisibility(Notification.VISIBILITY_PUBLIC).setOngoing(true).build())
            val before=audio.getStreamVolume(AudioManager.STREAM_ALARM)
            check(prefs.edit().putInt("previous",before).commit()) { "Cannot safely journal alarm volume" }
            audio.setStreamVolume(AudioManager.STREAM_ALARM,audio.getStreamMaxVolume(AudioManager.STREAM_ALARM),0)
            // Deadline is based on elapsed time, not the device's editable wall clock.
            val deadline=SystemClock.elapsedRealtime()+seconds*1000L
            handler.postAtTime({ stopSelf() },SystemClock.uptimeMillis()+seconds*1000L)
            val sound=RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: throw IllegalStateException("No alarm sound is configured")
            player=MediaPlayer().apply {
                setWakeMode(this@RemoteAlarmService,android.os.PowerManager.PARTIAL_WAKE_LOCK)
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                setDataSource(this@RemoteAlarmService,sound); isLooping=true
                setOnErrorListener { _,_,_-> pending[id]?.completeExceptionally(IllegalStateException("Alarm audio playback failed"));stopSelf(); true }
                setOnPreparedListener {
                    if(!stopping && SystemClock.elapsedRealtime()<deadline) {
                        try {
                            it.start()
                            pending[id]?.complete(JSONObject().put("state","audio_started").put("duration_seconds",seconds)
                                .put("note","Android audio playback started with a visible Stop control; audible output depends on device audio policy and hardware"))
                        } catch(e:Exception) { pending[id]?.completeExceptionally(e);stopSelf() }
                    } else stopSelf()
                }
                prepareAsync()
            }
            runCatching { startActivity(Intent(this,RemoteAlarmActivity::class.java).putExtra("reason",intent.getStringExtra("reason")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        } catch(e:Exception) {
            pending[id]?.completeExceptionally(e)
            DeviceLog.event(this,"error","command","remote_alarm_failed",e)
            stopSelf()
        }
        // If Android recreates the service after killing the process, onCreate restores volume;
        // a null restart intent stops it rather than replaying an alarm.
        return START_STICKY
    }
    private fun restoreVolume() {
        if(!prefs.contains("previous")) return
        runCatching { audio.setStreamVolume(AudioManager.STREAM_ALARM,prefs.getInt("previous",0),0) }
            .onSuccess { prefs.edit().remove("previous").commit() }
    }
    override fun onDestroy() {
        stopping=true;handler.removeCallbacksAndMessages(null)
        player?.release();player=null;restoreVolume();stopForeground(STOP_FOREGROUND_REMOVE)
        command?.let { pending[it]?.completeExceptionally(IllegalStateException("Alarm stopped before playback began")) }
        super.onDestroy()
    }
    override fun onTaskRemoved(rootIntent:Intent?) { stopSelf();super.onTaskRemoved(rootIntent) }
    companion object {
        private const val ID=960
        private const val STOP="stop_school_alarm"
        private val pending=mutableMapOf<String,CompletableDeferred<JSONObject>>()
        suspend fun start(context:Context,id:String,seconds:Int,reason:String,expires:Long):JSONObject {
            val completion=CompletableDeferred<JSONObject>()
            pending[id]=completion
            try {
                context.startForegroundService(Intent(context,RemoteAlarmService::class.java).putExtra("command",id).putExtra("seconds",seconds).putExtra("reason",reason).putExtra("expires",expires))
                return withTimeoutOrNull(10_000) { completion.await() }
                    ?: run { context.stopService(Intent(context,RemoteAlarmService::class.java));throw IllegalStateException("Alarm could not start within 10 seconds") }
            } finally { pending.remove(id) }
        }
    }
}
