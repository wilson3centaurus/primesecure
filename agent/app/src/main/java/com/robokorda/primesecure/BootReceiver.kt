package com.robokorda.primesecure

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.UserManager
import kotlinx.coroutines.*
import org.json.JSONObject

/** Re-arms the periodic check-in after a reboot or self-update and reports in straight away. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        // Some OEMs dispatch boot/update broadcasts while credential storage is locked.
        // The separate direct-boot receiver handles that phase without WorkManager.
        if (!context.getSystemService(UserManager::class.java).isUserUnlocked) {
            DeviceLog.record(context,"info","boot","boot_waiting_for_unlock")
            return
        }
        val pending = goAsync()
        CoroutineScope(SupervisorJob()+Dispatchers.IO).launch {
            try {
                val store = AgentStore(context)
                if (!store.isEnrolled) return@launch
                DeviceLog.event(context,"info","boot",if(intent.action==Intent.ACTION_MY_PACKAGE_REPLACED)"agent_updated" else "boot_unlocked")
                fun step(phase:String, block:()->Unit) {
                    try { block() } catch(e:Exception) {
                        if(e is CancellationException)throw e
                        DeviceLog.event(context,"error","boot","boot_step_failed",e,JSONObject().put("phase",phase))
                    }
                }
                // A scheduling/service failure must not kill the broadcast or skip other steps.
                step("diagnostics_schedule") { DiagnosticsWorker.schedule(context) }
                step("relock") {
                    if(store.lastStatus=="locked" && AdminReceiver.isDeviceOwner(context))
                        context.startActivity(LockActivity.intent(context))
                }
                step("check_in_schedule") { CheckInWorker.schedule(context) }
                step("check_in_now") { CheckInWorker.runNow(context) }
                step("agent_service_start") { AgentService.start(context) }
                step("pending_messages") { MessageActivity.showPending(context) }
            } catch(e:Exception) {
                if(e is CancellationException)throw e
                DeviceLog.event(context,"error","boot","boot_initialization_failed",e)
            } finally { pending.finish() }
        }
    }
}
