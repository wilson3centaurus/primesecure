package com.robokorda.primesecure

import android.content.Context

/** Everything the agent persists. Lives in app-private storage, which only we (and root) can read. */
class AgentStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("agent", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString("server_url", null)?.takeIf { it.isNotBlank() } ?: BuildConfig.SUPABASE_URL
        set(value) = prefs.edit().putString("server_url", value.trimEnd('/')).apply()

    var anonKey: String
        get() = prefs.getString("anon_key", null)?.takeIf { it.isNotBlank() } ?: BuildConfig.SUPABASE_ANON_KEY
        set(value) = prefs.edit().putString("anon_key", value.trim()).apply()

    val deviceId: String? get() = prefs.getString("device_id", null)
    val email: String? get() = prefs.getString("email", null)
    val password: String? get() = prefs.getString("password", null)
    val isEnrolled: Boolean get() = deviceId != null && email != null && password != null

    fun saveEnrollment(deviceId: String, email: String, password: String) {
        prefs.edit()
            .putString("device_id", deviceId)
            .putString("email", email)
            .putString("password", password)
            .remove("access_token").remove("refresh_token").remove("access_expires_at")
            .apply()
    }

    fun clearEnrollment() {
        prefs.edit().clear().apply()
    }

    var accessToken: String?
        get() = prefs.getString("access_token", null)
        set(value) = prefs.edit().putString("access_token", value).apply()

    var refreshToken: String?
        get() = prefs.getString("refresh_token", null)
        set(value) = prefs.edit().putString("refresh_token", value).apply()

    /** Epoch millis. */
    var accessExpiresAt: Long
        get() = prefs.getLong("access_expires_at", 0)
        set(value) = prefs.edit().putLong("access_expires_at", value).apply()

    var lastCheckInAt: Long
        get() = prefs.getLong("last_check_in_at", 0)
        set(value) = prefs.edit().putLong("last_check_in_at", value).apply()

    var lastStatus: String?
        get() = prefs.getString("last_status", null)
        set(value) = prefs.edit().putString("last_status", value).apply()

    var lastStatusMessage: String?
        get() = prefs.getString("last_status_message", null)
        set(value) = prefs.edit().putString("last_status_message", value).apply()

    /** Hash of the app list last accepted by the server, so it is only re-sent when it changes. */
    var reportedAppsHash: Int
        get() = prefs.getInt("reported_apps_hash", 0)
        set(value) = prefs.edit().putInt("reported_apps_hash", value).apply()

    /** The current web filter as JSON (see [WebFilter.toJson]), read by the School Browser. */
    var webFilter: String?
        get() = prefs.getString("web_filter", null)
        set(value) = prefs.edit().putString("web_filter", value).apply()

    var updateAttemptCode: Int
        get() = prefs.getInt("update_attempt_code", 0)
        set(value) = prefs.edit().putInt("update_attempt_code", value).apply()

    var updateAttemptAt: Long
        get() = prefs.getLong("update_attempt_at", 0)
        set(value) = prefs.edit().putLong("update_attempt_at", value).apply()

    var updateError: String?
        get() = prefs.getString("update_error", null)
        set(value) = prefs.edit().putString("update_error", value).apply()

    /** Most recent message command ids already displayed, oldest first (redelivery guard). */
    var shownMessageIds: List<String>
        get() = prefs.getString("shown_message_ids", null)?.split(',')?.filter { it.isNotEmpty() } ?: emptyList()
        set(value) = prefs.edit().putString("shown_message_ids", value.joinToString(",")).apply()

    var lastError: String?
        get() = prefs.getString("last_error", null)
        set(value) = prefs.edit().putString("last_error", value).apply()

    var lastPolicySummary: String?
        get() = prefs.getString("last_policy_summary", null)
        set(value) = prefs.edit().putString("last_policy_summary", value).apply()

    /** URL of the wallpaper we last set, so it is downloaded once, not on every check-in. */
    var appliedWallpaperUrl: String?
        get() = prefs.getString("applied_wallpaper_url", null)
        set(value) = prefs.edit().putString("applied_wallpaper_url", value).apply()

    /** Packages hidden by us, so we only ever unhide what we hid. */
    var hiddenByUs: Set<String>
        get() = prefs.getStringSet("hidden_by_us", emptySet())!!.toSet()
        set(value) = prefs.edit().putStringSet("hidden_by_us", value).apply()
}
