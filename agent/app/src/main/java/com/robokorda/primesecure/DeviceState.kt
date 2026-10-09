package com.robokorda.primesecure

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Converges lock / retire state. Suspension is handled by [PolicyApplier]. */
object DeviceState {

    suspend fun apply(context: Context, status: String) {
        if (!AdminReceiver.isDeviceOwner(context)) return
        when (status) {
            "locked" -> lock(context)
            "retired" -> retire(context)
            else -> unlock(context)
        }
    }

    private suspend fun lock(context: Context) {
        val dpm = AdminReceiver.dpm(context)
        val admin = AdminReceiver.component(context)
        dpm.setLockTaskPackages(admin, arrayOf(context.packageName))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // Power menu stays so the laptop can still be shut down; it relocks on boot.
            dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS)
        }
        withContext(Dispatchers.Main) {
            context.startActivity(LockActivity.intent(context))
        }
    }

    private suspend fun unlock(context: Context) {
        withContext(Dispatchers.Main) { LockActivity.finishIfShowing() }
        val dpm = AdminReceiver.dpm(context)
        val admin = AdminReceiver.component(context)
        if (dpm.getLockTaskPackages(admin).isNotEmpty()) dpm.setLockTaskPackages(admin, arrayOf())
    }

    /**
     * The school is done with this device: lift every restriction, forget the
     * enrollment and give up Device Owner. Irreversible without re-provisioning.
     */
    private suspend fun retire(context: Context) {
        unlock(context)
        val store = AgentStore(context)
        PolicyApplier(context, store).undoAll()
        CheckInWorker.cancel(context)
        store.clearEnrollment()
        @Suppress("DEPRECATION")
        AdminReceiver.dpm(context).clearDeviceOwnerApp(context.packageName)
    }
}
