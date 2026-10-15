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

    fun batteryDiagnostics(context: Context): JSONObject {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val manager = context.getSystemService(BatteryManager::class.java)
        val health = when (intent?.getIntExtra(BatteryManager.EXTRA_HEALTH, 1)) {
            BatteryManager.BATTERY_HEALTH_GOOD -> "good"
            BatteryManager.BATTERY_HEALTH_DEAD -> "dead"
            BatteryManager.BATTERY_HEALTH_OVERHEAT -> "overheat"
            BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> "over_voltage"
            BatteryManager.BATTERY_HEALTH_COLD -> "cold"
            BatteryManager.BATTERY_HEALTH_UNSPECIFIED_FAILURE -> "failure"
            else -> "unknown"
        }
        return JSONObject().apply {
            put("health", health)
            put("source", "Android BatteryManager")
            if (intent?.hasExtra(BatteryManager.EXTRA_TEMPERATURE) == true) put("temperature_c", intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) / 10.0)
            if (intent?.hasExtra(BatteryManager.EXTRA_VOLTAGE) == true) put("voltage_mv", intent.getIntExtra(BatteryManager.EXTRA_VOLTAGE, 0))
            val charge = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER)
            if (charge > 0) put("charge_uah", charge)
            val current = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW)
            if (current != Int.MIN_VALUE) put("current_ua", current)
            put("capacity_health_percent", JSONObject.NULL)
        }
    }

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
            // Re-granting location on each heartbeat can make OEMs repeatedly show
            // "Your IT admin allowed location". Permissions already granted need no write.
            if (context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) continue
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
                  .put("hidden",runCatching { AdminReceiver.dpm(context).isApplicationHidden(AdminReceiver.component(context),info.packageName) }.getOrDefault(false))
                  .put("suspended",runCatching { AdminReceiver.dpm(context).isPackageSuspended(AdminReceiver.component(context),info.packageName) }.getOrDefault(false))
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
            put("agent_version_code", BuildConfig.VERSION_CODE)
            put("prime_id", WifiInventory.primeId(context) ?: JSONObject.NULL)
            if (level >= 0 && scale > 0) put("battery_level", (level * 100 / scale).coerceIn(0, 100))
            if (battery != null) put("battery_charging", plugged != 0)
        }
    }
}
