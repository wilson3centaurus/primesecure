package com.robokorda.primesecure

import android.content.Context
import android.provider.Settings
import org.json.JSONObject

/** Authenticated RoboKorda licence result, kept separate from MDM lock state. */
object RoboKordaLicence {
    private const val PREFS = "robokorda-licence"
    private const val KEY_ENABLED = "validation_enabled"
    private const val KEY_STATE = "state"
    private const val KEY_PRIME_ID = "prime_id"
    private const val SECURE_ENABLED = "robokorda_licence_validation_enabled"
    private const val SECURE_STATE = "robokorda_licence_state"
    private const val SECURE_PRIME_ID = "robokorda_prime_id"

    fun observe(context: Context, payload: JSONObject?, deviceStatus: String) {
        if (payload == null) return
        val enabled = payload.optBoolean("validation_enabled", false)
        val state = payload.optString("state", "good").takeIf { it in setOf("good", "expired") } ?: "good"
        val primeId = payload.optString("prime_id").trim().ifEmpty { PrimeBookIdentity.displayId(context) }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_ENABLED, enabled).putString(KEY_STATE, state).putString(KEY_PRIME_ID, primeId).apply()
        // SystemUI integration reads these once a correctly signed RoboKorda
        // SystemUI build is available. PrimeSecure remains the authenticated
        // server client; SystemUI never receives the Supabase key.
        runCatching {
            Settings.Secure.putInt(context.contentResolver, SECURE_ENABLED, if (enabled) 1 else 0)
            Settings.Secure.putString(context.contentResolver, SECURE_STATE, if (enabled) state else "good")
            Settings.Secure.putString(context.contentResolver, SECURE_PRIME_ID, primeId)
        }
        applyCached(context, deviceStatus)
    }

    fun applyCached(context: Context, deviceStatus: String = AgentStore(context).lastStatus.orEmpty()) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val enforce = prefs.getBoolean(KEY_ENABLED, false) && prefs.getString(KEY_STATE, "good") == "expired"
        if (!enforce || deviceStatus in setOf("locked", "retired")) {
            RoboKordaLicenceActivity.finishIfShowing()
            return
        }
        if (!AdminReceiver.isDeviceOwner(context)) return
        val dpm = AdminReceiver.dpm(context)
        val admin = AdminReceiver.component(context)
        dpm.setLockTaskPackages(admin, arrayOf(context.packageName))
        context.startActivity(RoboKordaLicenceActivity.intent(context))
    }

    fun isEnforced(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_ENABLED, false) && prefs.getString(KEY_STATE, "good") == "expired"
    }

    fun primeId(context: Context): String = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(KEY_PRIME_ID, null)?.takeIf { it.isNotBlank() } ?: PrimeBookIdentity.displayId(context)
}
