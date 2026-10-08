package com.robokorda.primesecure

import android.app.WallpaperManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.os.Build
import android.os.UserManager
import android.provider.Settings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject

/**
 * Converges the device onto the policy the server returned. Idempotent: a
 * missing field means "off", so an empty policy undoes everything we applied.
 * Never touches apps or restrictions it didn't set itself.
 */
class PolicyApplier(private val context: Context, private val store: AgentStore) {

    private val dpm = AdminReceiver.dpm(context)
    private val admin = AdminReceiver.component(context)
    private val pm = context.packageManager

    /** Returns a short human-readable summary of the resulting state. */
    suspend fun apply(policy: JSONObject): String {
        if (!AdminReceiver.isDeviceOwner(context)) return "Not Device Owner — policy not applied"

        val problems = mutableListOf<String>()
        fun attempt(what: String, block: () -> Unit) {
            try {
                block()
            } catch (e: Exception) {
                problems += "$what: ${e.javaClass.simpleName}: ${e.message}"
            }
        }

        val lockWallpaper = policy.optBoolean("lock_wallpaper", false)
        val blockInstalls = policy.optBoolean("block_installs", false)
        val hideSettings = policy.optBoolean("hide_settings", false)
        val wallpaperUrl = policy.stringOrNull("wallpaper_url")

        wallpaperUrl?.takeIf { it != store.appliedWallpaperUrl }?.let { url ->
            try {
                setWallpaper(url)
                store.appliedWallpaperUrl = url
            } catch (e: Exception) {
                problems += "wallpaper: ${e.javaClass.simpleName}: ${e.message}"
            }
        }
        if (wallpaperUrl == null) store.appliedWallpaperUrl = null

        attempt("lock wallpaper") { restrict(UserManager.DISALLOW_SET_WALLPAPER, lockWallpaper) }
        attempt("block installs") {
            restrict(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES, blockInstalls)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                restrict(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES_GLOBALLY, blockInstalls)
            }
        }

        var hiddenCount = 0
        attempt("app visibility") {
            hiddenCount = applyAppVisibility(
                hidden = policy.stringSet("hidden_apps"),
                allowed = policy.stringSet("allowed_apps"),
                hideSettings = hideSettings,
            )
        }

        val summary = buildString {
            append("Policy: ").append(policy.optString("scope", "none"))
            append(" · wallpaper ").append(if (wallpaperUrl != null) "set" else "unmanaged")
            if (lockWallpaper) append(" (locked)")
            append(" · installs ").append(if (blockInstalls) "blocked" else "allowed")
            append(" · settings ").append(if (hideSettings) "hidden" else "visible")
            append(" · $hiddenCount app(s) hidden")
            problems.forEach { append("\n⚠ ").append(it) }
        }
        return summary
    }

    private fun restrict(key: String, on: Boolean) {
        if (on) dpm.addUserRestriction(admin, key) else dpm.clearUserRestriction(admin, key)
    }

    private suspend fun setWallpaper(url: String) {
        val bitmap = withContext(Dispatchers.IO) {
            val request = Request.Builder().url(url).build()
            SupabaseApi.http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) error("HTTP ${response.code}")
                val bytes = response.body?.bytes() ?: error("empty body")
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: error("not an image")
            }
        }
        // Lift our own wallpaper lock for the moment it takes to change it.
        val locked = dpm.getUserRestrictions(admin).getBoolean(UserManager.DISALLOW_SET_WALLPAPER)
        if (locked) dpm.clearUserRestriction(admin, UserManager.DISALLOW_SET_WALLPAPER)
        try {
            val wm = WallpaperManager.getInstance(context)
            wm.setBitmap(bitmap, null, true, WallpaperManager.FLAG_SYSTEM or WallpaperManager.FLAG_LOCK)
        } finally {
            if (locked) dpm.addUserRestriction(admin, UserManager.DISALLOW_SET_WALLPAPER)
        }
    }

    /**
     * Hidden = hidden_apps ∪ Settings (if hide_settings) ∪ (every launchable app
     * outside allowed_apps, when that list is non-empty), minus apps the device
     * can't function without. Returns how many apps we now hide.
     */
    private fun applyAppVisibility(hidden: Set<String>, allowed: Set<String>, hideSettings: Boolean): Int {
        val previouslyHidden = store.hiddenByUs
        val protected = protectedPackages(hideSettings)

        val want = buildSet {
            addAll(hidden)
            if (hideSettings) addAll(SETTINGS_PACKAGES)
            if (allowed.isNotEmpty()) {
                // Apps we hid no longer show up as launchable, so include them as candidates.
                (launchablePackages() + previouslyHidden).filterTo(this) { it !in allowed }
            }
        } - protected

        val nowHidden = mutableSetOf<String>()
        for (pkg in want) {
            if (dpm.isApplicationHidden(admin, pkg) || dpm.setApplicationHidden(admin, pkg, true)) {
                nowHidden += pkg
            }
        }
        for (pkg in previouslyHidden - want) {
            dpm.setApplicationHidden(admin, pkg, false)
        }
        // Remember what we hid (including apps we've hidden before that are still
        // wanted) so a later policy change can put back exactly these.
        store.hiddenByUs = nowHidden
        return nowHidden.size
    }

    private fun launchablePackages(): Set<String> {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return pm.queryIntentActivities(intent, 0).map { it.activityInfo.packageName }.toSet()
    }

    /** Never hide these, whatever the policy says, or the laptop becomes unusable. */
    private fun protectedPackages(hideSettings: Boolean): Set<String> = buildSet {
        add(context.packageName)
        add("com.android.systemui")
        add("android")
        homePackage()?.let(::add)
        defaultInputMethodPackage()?.let(::add)
        if (!hideSettings) addAll(SETTINGS_PACKAGES)
    }

    private fun homePackage(): String? {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        return pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName
            ?.takeIf { it != "android" } // "android" = the chooser, i.e. no default set
    }

    private fun defaultInputMethodPackage(): String? =
        Settings.Secure.getString(context.contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
            ?.substringBefore('/')

    /** Called from the debug "release" button and, later, the retire command. */
    fun undoAll() {
        listOf(
            UserManager.DISALLOW_SET_WALLPAPER,
            UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES,
        ).forEach { runCatching { dpm.clearUserRestriction(admin, it) } }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            runCatching { dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES_GLOBALLY) }
        }
        (store.hiddenByUs + SETTINGS_PACKAGES).forEach { runCatching { dpm.setApplicationHidden(admin, it, false) } }
        store.hiddenByUs = emptySet()
        store.appliedWallpaperUrl = null
    }

    companion object {
        val SETTINGS_PACKAGES = setOf("com.android.settings")
    }
}

internal fun JSONObject.stringOrNull(key: String): String? =
    if (!has(key) || isNull(key)) null else optString(key).trim().ifEmpty { null }

internal fun JSONObject.stringSet(key: String): Set<String> {
    val array: JSONArray = optJSONArray(key) ?: return emptySet()
    return (0 until array.length()).mapNotNull { i -> array.optString(i).trim().ifEmpty { null } }.toSet()
}
