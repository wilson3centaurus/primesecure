package com.robokorda.primesecure

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Re-arms the periodic check-in after a reboot or self-update and reports in straight away. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (!AgentStore(context).isEnrolled) return
        CheckInWorker.schedule(context)
        CheckInWorker.runNow(context)
    }
}
