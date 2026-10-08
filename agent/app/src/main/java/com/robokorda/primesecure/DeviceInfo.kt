package com.robokorda.primesecure

import android.Manifest
import android.annotation.SuppressLint
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject

object DeviceInfo {

    /** As Device Owner we can grant ourselves runtime permissions without a prompt. */
    fun grantOwnPermissions(context: Context) {
        if (!AdminReceiver.isDeviceOwner(context)) return
        val dpm = AdminReceiver.dpm(context)
        val permissions = buildList {
            add(Manifest.permission.READ_PHONE_STATE)
            add(Manifest.permission.ACCESS_COARSE_LOCATION)
            add(Manifest.permission.ACCESS_FINE_LOCATION)
            // Location is read from the background service / worker.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) add(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
        }
        for (permission in permissions) {
            runCatching {
                dpm.setPermissionGrantState(
                    AdminReceiver.component(context), context.packageName,
                    permission, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED,
                )
            }
        }
    }

    /** Launchable and user-installed apps, sorted, for the dashboard's app list. */
    fun installedApps(context: Context): JSONArray {
        val pm = context.packageManager
        val launchable = pm.queryIntentActivities(
            Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), PackageManager.MATCH_DISABLED_COMPONENTS,
        ).map { it.activityInfo.packageName }.toSet()
        @Suppress("DEPRECATION")
        val packages = pm.getInstalledPackages(PackageManager.MATCH_UNINSTALLED_PACKAGES)
        val apps = packages.mapNotNull { info ->
            val app = info.applicationInfo ?: return@mapNotNull null
            val system = app.flags and ApplicationInfo.FLAG_SYSTEM != 0
            if (system && info.packageName !in launchable) return@mapNotNull null
            JSONObject()
                .put("package", info.packageName)
                .put("label", app.loadLabel(pm).toString())
                .put("version", info.versionName ?: JSONObject.NULL)
                .put("system", system)
        }.sortedBy { it.getString("package") }
        return JSONArray(apps)
    }

    @SuppressLint("HardwareIds", "MissingPermission")
    fun collect(context: Context): JSONObject {
        val serial = runCatching { Build.getSerial() }.getOrNull()?.takeIf { it.isNotBlank() && it != Build.UNKNOWN }

        val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val plugged = battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0

        return JSONObject().apply {
            put("model", Build.MODEL)
            put("manufacturer", Build.MANUFACTURER)
            put("serial", serial ?: JSONObject.NULL)
            put("android_id", Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID))
            put("os_version", "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) ${Build.DISPLAY}")
            put("agent_version", BuildConfig.VERSION_NAME)
            if (level >= 0 && scale > 0) put("battery_level", (level * 100 / scale).coerceIn(0, 100))
            if (battery != null) put("battery_charging", plugged != 0)
        }
    }
}
