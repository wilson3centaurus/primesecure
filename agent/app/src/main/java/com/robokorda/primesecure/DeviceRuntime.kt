package com.robokorda.primesecure

import android.content.Context
import android.os.Environment
import android.os.StatFs
import android.os.UserManager
import org.json.JSONObject
import java.io.File

object DeviceRuntime {
    fun collect(context: Context): JSONObject {
        val stat = StatFs(Environment.getDataDirectory().path)
        val categories = JSONObject().put("Images", 0L).put("Videos", 0L).put("Music", 0L).put("Documents", 0L).put("Other shared files", 0L)
        runCatching {
            val inventory = JSONObject(File(context.filesDir, "file-inventory.json").readText()).getJSONArray("entries")
            for (i in 0 until inventory.length()) {
                val e = inventory.getJSONObject(i)
                if (e.optBoolean("dir") || e.optString("path").startsWith("@usb/")) continue
                val key = when {
                    e.optString("mime").startsWith("image/") -> "Images"
                    e.optString("mime").startsWith("video/") -> "Videos"
                    e.optString("mime").startsWith("audio/") -> "Music"
                    e.optString("name").substringAfterLast('.').lowercase() in setOf("pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "epub", "txt", "rtf", "odt") -> "Documents"
                    else -> "Other shared files"
                }
                categories.put(key, categories.getLong(key) + e.optLong("size"))
            }
        }
        val schoolBytes = File(context.filesDir, "school-notes").listFiles()?.filter { it.isFile }?.sumOf { it.length() } ?: 0
        val restrictions = runCatching { AdminReceiver.dpm(context).getUserRestrictions(AdminReceiver.component(context)) }.getOrNull()
        val usbRequested = HubStore(context).catalog.optJSONObject("management")?.optBoolean("block_usb_storage") == true
        val mountedUsb = File("/storage").listFiles()?.count { it.isDirectory && it.name.matches(Regex("[0-9a-fA-F]{4}-[0-9a-fA-F]{4}")) } ?: 0
        return JSONObject().put("storage", JSONObject().put("total", stat.totalBytes).put("free", stat.availableBytes).put("used", stat.totalBytes - stat.availableBytes)
            .put("school_content", schoolBytes).put("categories", categories).put("partial_inventory", true))
            .put("recovery", PasswordRecovery.status(context)).put("recovery_before_unlock",BootRecovery.registered(context)).put("online", Connectivity.online(context))
            .put("location",locationDiagnostics(context))
            .put("prime_id",WifiInventory.primeId(context) ?: JSONObject.NULL)
            .put("wifi",WifiInventory.collect(context))
            .put("usage",UsageReporter.status(context))
            .put("app_visibility",appVisibility(context))
            .put("safety",DeviceSafety.status(context))
            .put("controls",JSONObject()
                .put("bluetooth_sharing",restrictions?.getBoolean(UserManager.DISALLOW_BLUETOOTH_SHARING)==true)
                .put("bluetooth_disabled",restrictions?.getBoolean(UserManager.DISALLOW_BLUETOOTH)==true)
                .put("add_users",restrictions?.getBoolean(UserManager.DISALLOW_ADD_USER)==true)
                .put("switch_users",if(android.os.Build.VERSION.SDK_INT>=28) restrictions?.getBoolean(UserManager.DISALLOW_USER_SWITCH)==true else false)
                .put("factory_reset_settings",restrictions?.getBoolean(UserManager.DISALLOW_FACTORY_RESET)==true)
                .put("physical_media",restrictions?.getBoolean(UserManager.DISALLOW_MOUNT_PHYSICAL_MEDIA)==true)
                .put("lost_mode",LostMode.active(context))
                .put("limits","Firmware/login components stay protected. Factory reset restriction covers Android Settings, not recovery flashing. Bluetooth sharing blocks outgoing transfers; disable Bluetooth to also prevent incoming Bluetooth transfers. User/guest and USB/SD enforcement depends on PrimeOS. No remote or background camera/microphone capture."))
            .put("usb", JSONObject().put("storage_requested", usbRequested).put("storage_restriction_set", restrictions?.getBoolean(UserManager.DISALLOW_MOUNT_PHYSICAL_MEDIA) == true)
                .put("transfer_restriction_set", restrictions?.getBoolean(UserManager.DISALLOW_USB_FILE_TRANSFER) == true).put("mounted_drives", mountedUsb)
                .put("verification", if (usbRequested && mountedUsb > 0) "USB/SD media is still mounted. PrimeOS may not enforce this Android restriction, or the drive was mounted before it was applied." else "USB and SD enforcement requires separate physical-device tests."))
    }
    private fun appVisibility(context:Context):JSONObject {
        val prefs=context.getSharedPreferences("app-visibility-report",Context.MODE_PRIVATE)
        if(prefs.getString("device",null)!=AgentStore(context).deviceId)return JSONObject()
        val results=runCatching { org.json.JSONArray(prefs.getString("outcomes","[]")) }.getOrElse { org.json.JSONArray() }
        for(i in 0 until results.length()) {
            val row=results.getJSONObject(i);val pkg=row.optString("package")
            if(row.optString("status") in setOf("hidden","suspended"))runCatching {
                val dpm=AdminReceiver.dpm(context);val admin=AdminReceiver.component(context)
                row.put("status",if(dpm.isApplicationHidden(admin,pkg))"hidden" else if(dpm.isPackageSuspended(admin,pkg))"suspended" else "visible")
            }.onFailure {row.put("status","unverified")}
        }
        return JSONObject().put("outcomes",results).put("policy_applied_at",prefs.getLong("updated",0))
    }
    @Suppress("MissingPermission","DEPRECATION")
    private fun locationDiagnostics(context:Context):JSONObject {
        val prefs=context.getSharedPreferences("location-diagnostics",Context.MODE_PRIVATE)
        val now=System.currentTimeMillis()
        val minutes=HubStore(context).catalog.optJSONObject("management")?.optInt("location_interval_minutes",30) ?: 30
        val prior=prefs.getString("reading",null)?.let { runCatching { JSONObject(it) }.getOrNull() }
        if(prior!=null && !SchoolControlRules.due(now,prefs.getLong("at",0),SchoolControlRules.locationIntervalMs(minutes,LostMode.active(context))))
            return prior.put("cached",true)
        val reading=runCatching {
        val manager=context.getSystemService(android.location.LocationManager::class.java)
        val providers=org.json.JSONArray()
        for(name in manager.allProviders) {
            val last=runCatching { manager.getLastKnownLocation(name) }.getOrNull()
            providers.put(JSONObject().put("provider",name).put("enabled",runCatching { manager.isProviderEnabled(name) }.getOrDefault(false))
                .put("age_seconds",if(last==null)JSONObject.NULL else ((android.os.SystemClock.elapsedRealtimeNanos()-last.elapsedRealtimeNanos)/1_000_000_000).coerceAtLeast(0))
                .put("mock",last?.isFromMockProvider ?: false).put("latitude",last?.latitude ?: JSONObject.NULL).put("longitude",last?.longitude ?: JSONObject.NULL)
                .put("reported_accuracy_m",if(last?.hasAccuracy()==true)last.accuracy else JSONObject.NULL))
        }
        JSONObject().put("gps_feature_declared",context.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_LOCATION_GPS))
            .put("providers",providers).put("note","Provider accuracy is unverified. Declared GPS support does not prove a satellite fix.")
        }.getOrElse { JSONObject().put("note","Location diagnostics unavailable") }
        reading.put("observed_at",java.time.Instant.ofEpochMilli(now).toString())
        prefs.edit().putString("reading",reading.toString()).putLong("at",now).apply()
        return reading
    }
}
