package com.robokorda.primesecure

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Keeps a Realtime connection open so commands and policy edits reach the
 * device within seconds instead of at the next 15-minute check-in. Anything
 * relevant just triggers a check-in, which applies policy and runs commands.
 */
class AgentService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var realtime: RealtimeClient? = null
    private var pendingCheckIn: Job? = null

    override fun onCreate() {
        super.onCreate()
        val notification = Notifications.service(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(Notifications.SERVICE_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(Notifications.SERVICE_ID, notification)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val store = AgentStore(this)
        if (!store.isEnrolled) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (realtime == null) {
            realtime = RealtimeClient(
                store, scope,
                onConnected = { checkInSoon() }, // catch up on anything missed while disconnected
                onChange = { table, record -> onChange(store, table, record) },
            ).also { it.start() }
        }
        return START_STICKY
    }

    private fun onChange(store: AgentStore, table: String, record: JSONObject?) {
        when (table) {
            "commands", "policies" -> checkInSoon()
            // Every check-in updates our own row; only a status change needs action.
            "devices" -> if (record?.optString("status") != store.lastStatus) checkInSoon()
        }
    }

    /** Coalesces bursts (e.g. a message sent to the whole school) into one check-in. */
    private fun checkInSoon() {
        pendingCheckIn?.cancel()
        pendingCheckIn = scope.launch {
            delay(1_500)
            CheckInWorker.runNow(this@AgentService)
        }
    }

    override fun onDestroy() {
        realtime?.stop()
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        fun start(context: Context) {
            if (!AgentStore(context).isEnrolled) return
            val intent = Intent(context, AgentService::class.java)
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
                else context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, AgentService::class.java))
        }
    }
}
