package com.robokorda.primesecure

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.security.SecureRandom

/** Android's escrow token is private to this device and is never returned to the server or WebView. */
object PasswordRecovery {
    private fun prefs(context: Context) = context.getSharedPreferences("password-recovery", Context.MODE_PRIVATE)
    fun status(context: Context): String = runCatching {
        if (!AdminReceiver.isDeviceOwner(context)) "unsupported"
        else if (prefs(context).getString("device",null)!=AgentStore(context).deviceId) "not_enabled"
        else if (prefs(context).getString("token", null) == null) "not_enabled"
        else if (AdminReceiver.dpm(context).isResetPasswordTokenActive(AdminReceiver.component(context))) "ready" else "needs_confirmation"
    }.getOrDefault("unsupported")
    fun activate(activity: Activity) {
        check(AdminReceiver.isDeviceOwner(activity)) { "Device-owner access is required." }
        val prefs = prefs(activity)
        if (prefs.getString("device", null) != AgentStore(activity).deviceId) prefs.edit().clear().putString("device", AgentStore(activity).deviceId).commit()
        if (prefs.getString("token", null) == null) {
            val token = ByteArray(32).also { SecureRandom().nextBytes(it) }
            // Persist before registering so a crash cannot leave an escrow token we no longer know.
            check(prefs.edit().putString("token", Base64.encodeToString(token, Base64.NO_WRAP)).commit())
            if (!AdminReceiver.dpm(activity).setResetPasswordToken(AdminReceiver.component(activity), token)) {
                prefs.edit().remove("token").commit(); error("Password recovery is not supported by this Primebook.")
            }
        }
        if (status(activity) == "needs_confirmation") {
            // Android discards an inactive escrow token at reboot; register our saved token again.
            val token=Base64.decode(prefs.getString("token",null) ?: error("Recovery token unavailable"),Base64.NO_WRAP)
            check(AdminReceiver.dpm(activity).setResetPasswordToken(AdminReceiver.component(activity),token)) { "Password recovery is unavailable on this device." }
            val intent = activity.getSystemService(KeyguardManager::class.java).createConfirmDeviceCredentialIntent("Enable school password recovery", "Confirm your current device password once. Your school can then reset it if you forget it.")
            if (intent != null) activity.startActivityForResult(intent, 803)
        }
    }
    fun reset(context: Context, payload: JSONObject): JSONObject {
        payload.stringOrNull("expires_at")?.let { check(java.time.Instant.parse(it).toEpochMilli()>System.currentTimeMillis()) { "This temporary password reset has expired. Ask the administrator to send a new one." } }
        check(status(context) == "ready") { "Recovery must first be activated on this Primebook while its student can unlock it." }
        val password = payload.getString("password")
        require(password.length in 6..64) { "Choose a temporary password between 6 and 64 characters." }
        val token = Base64.decode(prefs(context).getString("token", null) ?: error("Recovery token unavailable"), Base64.NO_WRAP)
        check(AdminReceiver.dpm(context).resetPasswordWithToken(AdminReceiver.component(context), password, token, 0)) { "Android rejected the password reset. Check the device's password policy." }
        return JSONObject().put("reset", true)
    }
    fun clear(context: Context) {
        runCatching { AdminReceiver.dpm(context).clearResetPasswordToken(AdminReceiver.component(context)) }
        prefs(context).edit().clear().commit()
        BootRecovery.clear(context)
    }
    suspend fun registerBoot(context:Context) {
        if(status(context)!="ready"||BootRecovery.registered(context))return
        val token=Base64.decode(prefs(context).getString("token",null) ?: return,Base64.NO_WRAP)
        BootRecovery.register(context,token)
    }
}
