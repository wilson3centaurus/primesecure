package com.robokorda.primesecure

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.PersistableBundle

class AdminReceiver : DeviceAdminReceiver() {
    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        if (isDeviceOwner(context)) context.startActivity(Provisioning.completionIntent(context, intent))
    }
    override fun onTransferOwnershipComplete(context: Context, bundle: PersistableBundle?) {
        if (isDeviceOwner(context)) context.startActivity(Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .apply { bundle?.getString("token")?.takeIf { it.isNotBlank() }?.let { putExtra("token", it) } })
    }
    companion object {
        fun component(context: Context) = ComponentName(context, AdminReceiver::class.java)

        fun dpm(context: Context) =
            context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

        fun isDeviceOwner(context: Context) = dpm(context).isDeviceOwnerApp(context.packageName)
    }
}
