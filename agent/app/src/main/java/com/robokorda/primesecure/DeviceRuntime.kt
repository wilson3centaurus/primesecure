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
            .put("usb", JSONObject().put("storage_requested", usbRequested).put("storage_restriction_set", restrictions?.getBoolean(UserManager.DISALLOW_MOUNT_PHYSICAL_MEDIA) == true)
                .put("transfer_restriction_set", restrictions?.getBoolean(UserManager.DISALLOW_USB_FILE_TRANSFER) == true).put("mounted_drives", mountedUsb)
                .put("verification", if (usbRequested && mountedUsb > 0) "Physical media is still mounted. PrimeOS may not enforce this Android restriction, or the drive was mounted before it was applied." else "Physical USB enforcement requires a device test."))
    }
    @Suppress("MissingPermission","DEPRECATION")
    private fun locationDiagnostics(context:Context):JSONObject = runCatching {
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
}
