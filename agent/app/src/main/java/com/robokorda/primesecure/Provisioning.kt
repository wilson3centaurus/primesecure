package com.robokorda.primesecure

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PersistableBundle
import android.provider.Settings

/** Requests Android-authorized provisioning. Never substitutes legacy admin for Device Owner. */
internal object Provisioning {
    const val REQUEST = 806
    private fun prefs(context: Context) = context.getSharedPreferences("enrollment-flow", Context.MODE_PRIVATE)
    fun pendingToken(context: Context) = prefs(context).getString("token", null)
    fun clear(context: Context) { prefs(context).edit().clear().commit() }

    /**
     * PrimeSecure replaces the removed OEM setup wizard in RoboKorda firmware.
     * Close Android's setup window only after Device Owner and school enrollment
     * have both succeeded; doing this earlier would block owner provisioning.
     */
    fun finishSystemSetup(context: Context) {
        check(AdminReceiver.isDeviceOwner(context)) {
            "PrimeSecure must be Device Owner before system setup can finish."
        }
        check(Settings.Global.putInt(
            context.contentResolver,
            Settings.Global.DEVICE_PROVISIONED,
            1,
        )) { "Android did not accept the device_provisioned marker." }
        check(Settings.Secure.putInt(
            context.contentResolver,
            "user_setup_complete",
            1,
        )) { "Android did not accept the user_setup_complete marker." }
        DeviceLog.record(context, "info", "setup", "system_setup_completed")
    }

    @Suppress("DEPRECATION")
    fun unavailableReason(context: Context): String? {
        if (AdminReceiver.isDeviceOwner(context)) return null
        if (Settings.Global.getInt(context.contentResolver, Settings.Global.DEVICE_PROVISIONED, 0) != 0 ||
            Settings.Secure.getInt(context.contentResolver, "user_setup_complete", 0) != 0)
            return "Android setup is already complete but PrimeSecure is not Device Owner. Open full device diagnostics, collect the V8 report and use the fixed firmware retry. PrimeSecure will not replace another owner or weaken Android's authorization rules."
        if (Build.VERSION.SDK_INT >= 31) return "This Android version requires management through its initial device setup or a manufacturer-approved provisioning method."
        val intent = Intent(DevicePolicyManager.ACTION_PROVISION_MANAGED_DEVICE)
        if (intent.resolveActivity(context.packageManager) == null) return "Android's provisioning activity is unavailable. Open full device diagnostics and collect the V8 bootstrap report."
        if (!AdminReceiver.dpm(context).isProvisioningAllowed(DevicePolicyManager.ACTION_PROVISION_MANAGED_DEVICE))
            return "Android is not allowing Device Owner setup from an app on this Primebook. It may have completed initial setup or already have management. Your school technician must finish provisioning; an enrollment key alone cannot grant this permission."
        return null
    }

    @Suppress("DEPRECATION")
    fun request(activity: Activity, token: String) {
        unavailableReason(activity)?.let { error(it) }
        check(!AdminReceiver.isDeviceOwner(activity)) { "Device management is already active." }
        check(prefs(activity).edit().putString("token", token.trim().uppercase()).commit())
        activity.startActivityForResult(Intent(DevicePolicyManager.ACTION_PROVISION_MANAGED_DEVICE)
            .putExtra(DevicePolicyManager.EXTRA_PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME, AdminReceiver.component(activity))
            .putExtra(DevicePolicyManager.EXTRA_PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED, true)
            .putExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE,
                PersistableBundle().apply { putString("token", token.trim().uppercase()) }), REQUEST)
    }

    @Suppress("DEPRECATION")
    fun completionIntent(context: Context, source: Intent): Intent {
        val token = source.getParcelableExtra<PersistableBundle>(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE)
            ?.getString("token") ?: pendingToken(context)
        return Intent(context, DeviceSetupActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .apply { if (!token.isNullOrBlank()) putExtra("token", token) }
    }
}
