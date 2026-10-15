package com.robokorda.primesecure

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import org.json.JSONObject

/** Current connection only. Never scans nearby networks or reads saved Wi-Fi passwords. */
object WifiInventory {
    fun invalidate(context: Context) { context.getSharedPreferences("wifi-inventory", Context.MODE_PRIVATE).edit().remove("at").apply() }
    fun primeId(context: Context): String? = runCatching {
        if (!AdminReceiver.isDeviceOwner(context)) return@runCatching null
        SchoolControlRules.inventoryMac(AdminReceiver.dpm(context).getWifiMacAddress(AdminReceiver.component(context)))
    }.getOrNull()

    @Suppress("DEPRECATION", "MissingPermission")
    fun collect(context: Context, force: Boolean = false): JSONObject {
        val prefs = context.getSharedPreferences("wifi-inventory", Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val management = HubStore(context).catalog.optJSONObject("management")
        val interval = SchoolControlRules.locationIntervalMs(management?.optInt("location_interval_minutes", 30) ?: 30, LostMode.active(context))
        val cm = context.getSystemService(ConnectivityManager::class.java)
        val connected = cm.getNetworkCapabilities(cm.activeNetwork)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
        val prior = prefs.getString("reading", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
        if (!force && prior != null && !SchoolControlRules.due(now, prefs.getLong("at", 0), interval)) {
            return JSONObject(prior.toString()).put("connected", connected).put("cached", true)
                .apply { if (!connected) { remove("ssid"); remove("bssid") } }
        }
        val reading = JSONObject().put("connected", connected).put("observed_at", java.time.Instant.ofEpochMilli(now).toString())
        if (connected) runCatching {
            val info = context.applicationContext.getSystemService(WifiManager::class.java).connectionInfo
            info.ssid?.removeSurrounding("\"")?.takeIf { it.isNotBlank() && it != "<unknown ssid>" }?.let { reading.put("ssid", it) }
            SchoolControlRules.inventoryMac(info.bssid)?.let { reading.put("bssid", it) }
            reading.put("rssi_dbm", info.rssi).put("link_speed_mbps", info.linkSpeed).put("frequency_mhz", info.frequency)
        }
        prefs.edit().putString("reading", reading.toString()).putLong("at", now).apply()
        return reading
    }
}
