package com.robokorda.primesecure

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import org.json.JSONObject

/** Stable first-boot identity. Serial is primary; the factory Wi-Fi MAC is inventory fallback only. */
object PrimeBookIdentity {
    // Device Owner + READ_PHONE_STATE is the supported access path here; lint
    // cannot infer the runtime Device Owner state of this privileged app.
    @SuppressLint("HardwareIds", "MissingPermission")
    fun serial(): String? = runCatching { Build.getSerial() }.getOrNull()
        ?.trim()?.uppercase()?.takeIf { it.isNotEmpty() && it != Build.UNKNOWN }

    fun factoryWifiMac(context: Context): String? = WifiInventory.factoryWifiMac(context)

    fun displayId(context: Context): String = serial() ?: factoryWifiMac(context) ?: "Identity pending"

    fun json(context: Context): JSONObject = JSONObject()
        .put("hardware_id", displayId(context))
        .put("serial", serial() ?: JSONObject.NULL)
        .put("prime_id", displayId(context))
        .put("legacy_wifi_mac", factoryWifiMac(context) ?: JSONObject.NULL)
}
