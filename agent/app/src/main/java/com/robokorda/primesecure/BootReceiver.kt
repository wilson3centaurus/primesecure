package com.robokorda.primesecure

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Re-arms the periodic check-in after a reboot or self-update and reports in straight away. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val store = AgentStore(context)
        if (!store.isEnrolled) return
        // Relock straight away, even before the network (and a check-in) is back.
        if (store.lastStatus == "locked" && AdminReceiver.isDeviceOwner(context)) {
            runCatching { context.startActivity(LockActivity.intent(context)) }
        }
        CheckInWorker.schedule(context)
        CheckInWorker.runNow(context)
        AgentService.start(context)
    }
}
