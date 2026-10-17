package com.robokorda.primesecure

import android.content.Context
import android.content.Intent
import org.json.JSONObject

/** Per-enrollment setup checkpoints, independent of activity lifetime and network availability. */
internal class InitialSetup(private val context: Context) {
    private val prefs = context.getSharedPreferences("initial-setup", Context.MODE_PRIVATE)
    init { synchronized(lock) {
        val device = AgentStore(context).deviceId
        if (prefs.getString("device", null) != device) {
            check(prefs.edit().clear().putString("device", device).commit())
        }
    } }
    val pending get() = prefs.getBoolean("required", false) && !prefs.getBoolean("complete", false)
    val policyReady get() = prefs.getBoolean("policy_ready", false)
    val catalogReady get() = prefs.getBoolean("catalog_ready", false)
    val policyError: String? get() = prefs.getString("policy_error", null)
    fun begin() { check(prefs.edit().putBoolean("required", true).putBoolean("complete", false)
        .putBoolean("policy_ready", false).putBoolean("catalog_ready", false).remove("policy_error").commit()) }
    fun policyResult(problems: List<String>) {
        check(prefs.edit().putBoolean("policy_ready", problems.isEmpty())
            .putString("policy_error", problems.takeIf { it.isNotEmpty() }?.joinToString("\n")).commit())
    }
    fun catalogReceived() { check(prefs.edit().putBoolean("catalog_ready", true).commit()) }
    fun finish() {
        check(prefs.edit().putBoolean("complete", true).commit())
        DeviceLog.event(context,"info","setup","preparation_handed_to_background")
    }
    fun destination() = Intent(context, if (pending) SetupActivity::class.java else HubActivity::class.java)

    companion object {
        private val lock = Any()
        fun starterIds(items: List<JSONObject>) = SetupRequirements.starterResources(items.filter {
            it.optString("kind") == "resource"
        }.map { StarterResource(it.getString("id"), it.optLong("size", -1)) })
        fun requiredApps(catalog: JSONObject, items: List<JSONObject>): List<JSONObject> {
            val viewers = catalog.optJSONObject("management")?.optJSONObject("viewer_packages")
            val packages = viewers?.keys()?.asSequence()?.map { viewers.optString(it) }?.toSet() ?: emptySet()
            return items.filter { it.optString("kind") == "app" &&
                (it.optBoolean("preinstall") || it.optString("package_name") in packages) }
        }
    }
}
