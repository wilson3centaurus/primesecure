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

    @Suppress("DEPRECATION")
    fun unavailableReason(context: Context): String? {
        if (AdminReceiver.isDeviceOwner(context)) return null
        if (Settings.Global.getInt(context.contentResolver, Settings.Global.DEVICE_PROVISIONED, 0) != 0 ||
            Settings.Secure.getInt(context.contentResolver, "user_setup_complete", 0) != 0)
            return "This Primebook has already completed its system setup. An installed app cannot make itself Device Owner now. Your school technician must use authorized adb provisioning or Primebook's manufacturer setup integration. Do not reset again just to try this button."
        if (Build.VERSION.SDK_INT >= 31) return "This Android version requires management through its initial device setup or a manufacturer-approved provisioning method."
        val intent = Intent(DevicePolicyManager.ACTION_PROVISION_MANAGED_DEVICE)
        if (intent.resolveActivity(context.packageManager) == null) return "PrimeOS does not expose Android's device-management setup on this device. Your school technician must use an authorized provisioning method."
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
        return Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .apply { if (!token.isNullOrBlank()) putExtra("token", token) }
    }
}
