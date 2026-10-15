package com.robokorda.primesecure

import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Looper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Request
import org.json.JSONObject
import kotlin.coroutines.resume

/**
 * Best-effort position for the 'locate' command. Reported GNSS hardware support
 * does not guarantee a real fix. Try GPS first, then network/fused providers, then a
 * recent last-known fix, then a city-level IP lookup.
 */
class Locator(private val context: Context, private val store: AgentStore) {

    private val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

    /** Heartbeats remain fast; location permission/provider reads happen only on this cadence. */
    suspend fun locateScheduled(): JSONObject? {
        val prefs = context.getSharedPreferences("location-cadence", Context.MODE_PRIVATE)
        val minutes = HubStore(context).catalog.optJSONObject("management")?.optInt("location_interval_minutes", 30) ?: 30
        val now = System.currentTimeMillis()
        if (!SchoolControlRules.due(now, prefs.getLong("attempt", 0), SchoolControlRules.locationIntervalMs(minutes, LostMode.active(context)))) return null
        return locate()
    }

    suspend fun locate(): JSONObject {
        // Failed provider lookups must not cause a new location access every heartbeat.
        context.getSharedPreferences("location-cadence", Context.MODE_PRIVATE).edit().putLong("attempt", System.currentTimeMillis()).apply()
        DeviceInfo.grantOwnPermissions(context)
        ensureLocationOn()

        val fix = fromProviders() ?: lastKnown()
        val (lat, lng, accuracy, source) = if (fix != null) {
            Fix(fix.latitude, fix.longitude, fix.accuracy.takeIf { fix.hasAccuracy() }, sourceOf(fix.provider))
        } else {
            ipLookup() ?: error("no location provider and IP lookup failed")
        }

        SupabaseApi(store).rpc("device_report_location", JSONObject()
            .put("p_lat", lat).put("p_lng", lng)
            .put("p_accuracy", accuracy ?: JSONObject.NULL)
            .put("p_source", source))
        return JSONObject().put("lat", lat).put("lng", lng)
            .put("accuracy", accuracy ?: JSONObject.NULL).put("source", source)
    }

    private data class Fix(val lat: Double, val lng: Double, val accuracy: Float?, val source: String)

    private fun ensureLocationOn() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R || !AdminReceiver.isDeviceOwner(context)) return
        if (!lm.isLocationEnabled) {
            runCatching { AdminReceiver.dpm(context).setLocationEnabled(AdminReceiver.component(context), true) }
        }
    }

    private fun usableProviders(): List<String> =
        listOf(LocationManager.GPS_PROVIDER, "fused", LocationManager.NETWORK_PROVIDER)
            .filter { it in lm.allProviders && runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) }

    private suspend fun fromProviders(): Location? {
        for (provider in usableProviders()) {
            val fix = withTimeoutOrNull(if(provider==LocationManager.GPS_PROVIDER)15_000L else 10_000L) { current(provider) }
            if (fix != null && valid(fix)) return fix
        }
        return null
    }

    @Suppress("MissingPermission")
    private suspend fun current(provider: String): Location? = withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { cont ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val cancel = android.os.CancellationSignal()
                cont.invokeOnCancellation { cancel.cancel() }
                lm.getCurrentLocation(provider, cancel, context.mainExecutor) { cont.resume(it) }
            } else {
                val listener = object : LocationListener {
                    override fun onLocationChanged(location: Location) {
                        lm.removeUpdates(this)
                        if (cont.isActive) cont.resume(location)
                    }
                    @Deprecated("Deprecated in API 29")
                    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
                    override fun onProviderEnabled(provider: String) = Unit
                    override fun onProviderDisabled(provider: String) = Unit
                }
                cont.invokeOnCancellation { lm.removeUpdates(listener) }
                @Suppress("DEPRECATION")
                lm.requestSingleUpdate(provider, listener, Looper.getMainLooper())
            }
        }
    }

    @Suppress("MissingPermission")
    private fun lastKnown(): Location? {
        val fresh = System.currentTimeMillis() - 2 * 60_000
        return usableProviders()
            .mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
            .filter { it.time >= fresh && valid(it) }
            .minByOrNull { if (it.hasAccuracy()) it.accuracy else Float.MAX_VALUE }
    }

    private fun sourceOf(provider: String?) = when (provider) {
        LocationManager.GPS_PROVIDER -> "gps"
        LocationManager.PASSIVE_PROVIDER -> "passive"
        "fused" -> "fused"
        else -> "network"
    }
    @Suppress("DEPRECATION")
    private fun valid(location:Location):Boolean = !location.isFromMockProvider && location.latitude.isFinite() && location.longitude.isFinite() &&
        location.latitude in -90.0..90.0 && location.longitude in -180.0..180.0 &&
        location.elapsedRealtimeNanos>0 && android.os.SystemClock.elapsedRealtimeNanos()-location.elapsedRealtimeNanos in 0..120_000_000_000L

    /** City-level position of the school's internet connection. */
    private suspend fun ipLookup(): Fix? = withContext(Dispatchers.IO) {
        val services = listOf(
            "https://ipapi.co/json/" to ("latitude" to "longitude"),
            "https://ipwho.is/" to ("latitude" to "longitude"),
        )
        for ((url, keys) in services) {
            val fix = runCatching {
                SupabaseApi.http.newCall(Request.Builder().url(url).header("User-Agent", "PrimeSecure").build())
                    .execute().use { response ->
                        if (!response.isSuccessful) return@use null
                        val json = JSONObject(response.body?.string().orEmpty())
                        val lat = json.optDouble(keys.first, Double.NaN)
                        val lng = json.optDouble(keys.second, Double.NaN)
                        if (lat.isNaN() || lng.isNaN()) null else Fix(lat, lng, IP_ACCURACY_M, "ip")
                    }
            }.getOrNull()
            if (fix != null) return@withContext fix
        }
        null
    }

    companion object {
        private const val IP_ACCURACY_M = 5_000f
    }
}
