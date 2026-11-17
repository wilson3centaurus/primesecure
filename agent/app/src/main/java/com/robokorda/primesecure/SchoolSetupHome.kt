package com.robokorda.primesecure

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.util.Log

/**
 * Keeps the RoboKorda launcher available across factory reset and makes it the
 * persistent HOME once Android has authorised PrimeSecure as Device Owner.
 * Launcher3 remains installed because it supplies PrimeOS Quickstep/recents.
 */
object SchoolSetupHome {
    private const val TAG = "PrimeSecureHome"
    @Volatile private var persistedForProcess = false

    private fun component(context: Context) = ComponentName(context, SchoolLauncherActivity::class.java)

    private fun homeIntent() = Intent(Intent.ACTION_MAIN).apply {
        addCategory(Intent.CATEGORY_HOME)
        addCategory(Intent.CATEGORY_DEFAULT)
    }

    fun reconcile(context: Context) {
        setEnabled(context, true)
        if (AdminReceiver.isDeviceOwner(context)) makePreferred(context)
    }

    fun complete(context: Context) {
        setEnabled(context, true)
        if (AdminReceiver.isDeviceOwner(context)) makePreferred(context)
    }

    fun makePreferred(context: Context) {
        val target = component(context)
        // Persist at most once per process. On PrimeOS the desktop (Launcher3) can keep
        // winning HOME resolution after enrollment; re-clearing and re-adding the
        // persistent preference every policy pass (each minute) made Android
        // re-evaluate HOME repeatedly (observed screen flicker / launcher restarts).
        if (persistedForProcess) return
        val filter = IntentFilter(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            addCategory(Intent.CATEGORY_DEFAULT)
        }
        val dpm = AdminReceiver.dpm(context)
        val admin = AdminReceiver.component(context)
        runCatching {
            dpm.clearPackagePersistentPreferredActivities(admin, context.packageName)
            dpm.addPersistentPreferredActivity(admin, filter, target)
        }.onSuccess {
            persistedForProcess = true
            Log.i(TAG, "Persistent HOME requested; resolved=${resolvedHome(context)}")
        }.onFailure {
            Log.e(TAG, "Unable to persist SchoolLauncherActivity as HOME", it)
        }
    }

    fun resolvedHome(context: Context): ComponentName? = runCatching {
        context.packageManager.resolveActivity(
            homeIntent(), PackageManager.MATCH_DEFAULT_ONLY,
        )?.activityInfo?.let { ComponentName(it.packageName, it.name) }
    }.onFailure {
        Log.e(TAG, "Unable to resolve canonical HOME", it)
    }.getOrNull()

    fun clearPreferred(context: Context) {
        if (!AdminReceiver.isDeviceOwner(context)) return
        AdminReceiver.dpm(context).clearPackagePersistentPreferredActivities(
            AdminReceiver.component(context), context.packageName,
        )
    }

    private fun setEnabled(context: Context, enabled: Boolean) {
        val desired = if (enabled) PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        if (context.packageManager.getComponentEnabledSetting(component(context)) == desired) return
        context.packageManager.setComponentEnabledSetting(
            component(context), desired, PackageManager.DONT_KILL_APP,
        )
    }
}
