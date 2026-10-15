package com.robokorda.primesecure

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
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
    private var telemetryLoop: Job? = null
    private var networkCallback: android.net.ConnectivityManager.NetworkCallback? = null
    private var wifiLock: android.net.wifi.WifiManager.WifiLock? = null

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
            val cm=getSystemService(android.net.ConnectivityManager::class.java)
            networkCallback=object:android.net.ConnectivityManager.NetworkCallback() {
                override fun onCapabilitiesChanged(network:android.net.Network,caps:android.net.NetworkCapabilities) {
                    if(caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
                        checkInSoon()
                        scheduleSafely("network_hub") { HubSync.schedule(this@AgentService) }
                        scheduleSafely("network_outbox") {
                            if(HubTasks(this@AgentService).pending().any { it.optString("action") !in setOf("download","admin_command") }) OfflineWorker.schedule(this@AgentService)
                        }
                    }
                }
            }.also { cm.registerDefaultNetworkCallback(it) }
            scope.launch {
                runCatching { PolicyApplier(this@AgentService,store).applyCached() }
            }
        }
        return START_STICKY
            .also { if (telemetryLoop == null) telemetryLoop = scope.launch { var tick=0; while (true) {
                keepWifi(); delay(30_000L); tick++
                if(Connectivity.online(this@AgentService)) {
                    if(tick%2==0) {
                        scheduleSafely("periodic_check_in") { CheckInWorker.runNow(this@AgentService) }
                        scheduleSafely("periodic_hub") { HubSync.schedule(this@AgentService) }
                    }
                    scheduleSafely("periodic_outbox") {
                        if(HubTasks(this@AgentService).pending().any { it.optString("action") !in setOf("download","admin_command") }) OfflineWorker.schedule(this@AgentService)
                    }
                    if(tick%10==0) scheduleSafely("periodic_telemetry") { TelemetryWorker.schedule(this@AgentService) }
                }
            } } }
    }

    private fun onChange(store: AgentStore, table: String, record: JSONObject?) {
        when (table) {
            "commands", "policies" -> checkInSoon()
            "hub_items", "hub_access", "hub_settings", "support_messages" -> {
                checkInSoon();scheduleSafely("realtime_hub") { HubSync.schedule(this) }
            }
            // Every check-in updates our own row; only a status change needs action.
            "devices" -> if (record?.optString("status") != store.lastStatus) checkInSoon()
        }
    }

    /** Coalesces bursts (e.g. a message sent to the whole school) into one check-in. */
    private fun checkInSoon() {
        pendingCheckIn?.cancel()
        pendingCheckIn = scope.launch {
            delay(250)
            scheduleSafely("realtime_check_in") { CheckInWorker.runNow(this@AgentService) }
        }
    }

    private fun scheduleSafely(phase:String, block:()->Unit) {
        try { block() } catch(e:Exception) {
            if(e is CancellationException)throw e
            DeviceLog.event(this,"error","check_in","background_schedule_failed",e,JSONObject().put("phase",phase))
        }
    }

    override fun onDestroy() {
        networkCallback?.let { runCatching { getSystemService(android.net.ConnectivityManager::class.java).unregisterNetworkCallback(it) } }
        if(wifiLock?.isHeld==true)wifiLock?.release()
        realtime?.stop()
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
    @Suppress("DEPRECATION")
    private fun keepWifi() {
        val wanted=HubStore(this).catalog.optJSONObject("management")?.optBoolean("keep_wifi_on",true) != false
        if(!wanted) { if(wifiLock?.isHeld==true)wifiLock?.release(); return }
        runCatching {
            val wm=applicationContext.getSystemService(android.net.wifi.WifiManager::class.java)
            if(AdminReceiver.isDeviceOwner(this)&&!wm.isWifiEnabled) wm.isWifiEnabled=true
            if(wifiLock==null) wifiLock=wm.createWifiLock(android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF,"PrimeSecure:school-connection").apply { setReferenceCounted(false) }
            if(wifiLock?.isHeld==false)wifiLock?.acquire()
        }
    }

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
