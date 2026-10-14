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
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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

    /**
     * Returns a short human-readable summary of the resulting state. While
     * [suspended], only the policy's allowed apps stay usable (none if empty).
     */
    suspend fun apply(policy: JSONObject, suspended: Boolean = false): String {
        if (!AdminReceiver.isDeviceOwner(context)) return "Not Device Owner — policy not applied"

        val problems = mutableListOf<String>()
        dpm.setUninstallBlocked(admin, context.packageName, true)
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
        val management=policy.optJSONObject("hub_management") ?: JSONObject()
        attempt("USB storage") { restrict(UserManager.DISALLOW_MOUNT_PHYSICAL_MEDIA,management.optBoolean("block_usb_storage")) }
        attempt("USB file transfer") { restrict(UserManager.DISALLOW_USB_FILE_TRANSFER,management.optBoolean("block_usb_transfer")) }
        attempt("block installs") {
            restrict(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES, blockInstalls)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                restrict(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES_GLOBALLY, blockInstalls)
            }
        }

        var hiddenCount = 0
        attempt("app visibility") {
            hiddenCount = applyAppVisibility(
                hidden = policy.stringSet("hidden_apps") + if(management.optBoolean("hide_file_managers")) fileManagerPackages() else emptySet(),
                allowed = policy.stringSet("allowed_apps"),
                hideSettings = hideSettings || suspended,
                allowListOnly = suspended || management.optBoolean("approved_apps_only"),
            )
        }

        hiddenCount=store.hiddenByUs.size+store.suspendedByUs.size
        attempt("preferred viewers") { PreferredViewers.apply(context,management) }
        var webSummary = ""
        attempt("web filter") { webSummary = WebFilter.apply(context, store, WebFilter.fromPolicy(policy)) }

        val summary = buildString {
            if (suspended) append("SUSPENDED · ")
            append("Policy: ").append(policy.optString("scope", "none"))
            append(" · wallpaper ").append(if (wallpaperUrl != null) "set" else "unmanaged")
            if (lockWallpaper) append(" (locked)")
            append(" · installs ").append(if (blockInstalls) "blocked" else "allowed")
            append(" · settings ").append(if (hideSettings) "hidden" else "visible")
            append(" · $hiddenCount app(s) hidden")
            if (webSummary.isNotEmpty()) append(" · ").append(webSummary)
            problems.forEach { append("\n⚠ ").append(it) }
        }
        return summary
    }

    private fun restrict(key: String, on: Boolean) {
        if (on) dpm.addUserRestriction(admin, key) else dpm.clearUserRestriction(admin, key)
    }

    suspend fun setWallpaper(url: String): Unit = wallpaperLock.withLock { withContext(Dispatchers.IO) {
        val bitmap = withContext(Dispatchers.IO) {
            if (url.startsWith("hub:")) {
                val hub=HubStore(context)
                val saved=hub.items().find { it.optString("storage_path")==url.removePrefix("hub:") }?.let { hub.resourceFile(it) }
                if(saved?.exists()==true) return@withContext decodeWallpaper(saved)
                val file = java.io.File(context.cacheDir, "approved-wallpaper")
                try {
                    SupabaseApi(store).download("/storage/v1/object/primesecure-hub/" + url.removePrefix("hub:"), file)
                    decodeWallpaper(file)
                } finally { file.delete() }
            } else {
            val request = Request.Builder().url(url).build()
            SupabaseApi.http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) error("HTTP ${response.code}")
                val file=java.io.File(context.cacheDir,"policy-wallpaper")
                try {
                    val input=response.body?.byteStream() ?: error("empty body")
                    input.use { source -> file.outputStream().use { target ->
                        val buffer=ByteArray(8192);var total=0
                        while(true) {
                            val n=source.read(buffer)
                            if(n<0) break
                            total+=n
                            check(total<=20_000_000) { "Wallpaper is too large." }
                            target.write(buffer,0,n)
                        }
                    } }
                    decodeWallpaper(file)
                } finally { file.delete() }
            }
            }
        }
        // Lift our own wallpaper lock for the moment it takes to change it.
        val locked = dpm.getUserRestrictions(admin).getBoolean(UserManager.DISALLOW_SET_WALLPAPER)
        if (locked) dpm.clearUserRestriction(admin, UserManager.DISALLOW_SET_WALLPAPER)
        try {
            val wm = WallpaperManager.getInstance(context)
            wm.setBitmap(bitmap, null, true, WallpaperManager.FLAG_SYSTEM or WallpaperManager.FLAG_LOCK)
        } finally {
            bitmap.recycle()
            if (locked) dpm.addUserRestriction(admin, UserManager.DISALLOW_SET_WALLPAPER)
        }
    } }

    private fun decodeWallpaper(file: java.io.File): android.graphics.Bitmap {
        val options=BitmapFactory.Options().apply { inJustDecodeBounds=true }
        BitmapFactory.decodeFile(file.path,options)
        check(options.outWidth>0 && options.outHeight>0) { "Could not read this wallpaper." }
        options.inJustDecodeBounds=false;options.inSampleSize=1
        while(maxOf(options.outWidth,options.outHeight)/options.inSampleSize>2560) options.inSampleSize*=2
        return BitmapFactory.decodeFile(file.path,options) ?: error("Could not open this wallpaper.")
    }

    /**
     * Hidden = hidden_apps ∪ Settings (if hide_settings) ∪ (every launchable app
     * outside allowed_apps, when that list is non-empty or [allowListOnly]),
     * minus apps the device can't function without. Returns how many apps we now hide.
     */
    private fun applyAppVisibility(
        hidden: Set<String>,
        allowed: Set<String>,
        hideSettings: Boolean,
        allowListOnly: Boolean = false,
    ): Int {
        val previouslyHidden = store.hiddenByUs
        val previouslySuspended = store.suspendedByUs
        val protected = protectedPackages(hideSettings)

        val want = buildSet {
            addAll(hidden)
            if (hideSettings) addAll(SETTINGS_PACKAGES)
            if (allowed.isNotEmpty() || allowListOnly) {
                // Apps we hid no longer show up as launchable, so include them as candidates.
                (launchablePackages() + previouslyHidden + previouslySuspended).filterTo(this) { it !in allowed }
            }
        } - protected

        val nowHidden = mutableSetOf<String>()
        val nowSuspended = mutableSetOf<String>()
        val failures = mutableListOf<String>()
        for (pkg in want) {
            val hiddenOk=runCatching { dpm.isApplicationHidden(admin,pkg) || dpm.setApplicationHidden(admin,pkg,true) }.getOrDefault(false)
            if(hiddenOk) nowHidden+=pkg
            else if(runCatching { dpm.setPackagesSuspended(admin,arrayOf(pkg),true).isEmpty() }.getOrDefault(false)) nowSuspended+=pkg
            else failures+=pkg
        }
        for (pkg in previouslyHidden - want) runCatching { dpm.setApplicationHidden(admin,pkg,false) }
        for (pkg in previouslySuspended - nowSuspended) runCatching { dpm.setPackagesSuspended(admin,arrayOf(pkg),false) }
        store.hiddenByUs=nowHidden;store.suspendedByUs=nowSuspended
        check(failures.isEmpty()) { "Android could not block: ${failures.joinToString()}" }
        return nowHidden.size + nowSuspended.size
    }

    private fun launchablePackages(): Set<String> {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return pm.queryIntentActivities(intent, 0).map { it.activityInfo.packageName }.toSet()
    }
    private fun fileManagerPackages():Set<String> = setOf("com.android.documentsui","com.google.android.documentsui","com.cxinventor.file.explorer","com.floydwiz.filemanager","com.floydwiz.fileexplorer") +
        pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER),0).filter {
            it.loadLabel(pm).toString().lowercase() in setOf("files","file manager","file explorer","filemanager","fileexplorer")
        }.map { it.activityInfo.packageName }.filter { it!=context.packageName }

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
        runCatching { PreferredViewers.clear(context) }
        runCatching { dpm.setUninstallBlocked(admin, context.packageName, false) }
        listOf(
            UserManager.DISALLOW_SET_WALLPAPER,
            UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES,
            UserManager.DISALLOW_USB_FILE_TRANSFER,
            UserManager.DISALLOW_MOUNT_PHYSICAL_MEDIA,
        ).forEach { runCatching { dpm.clearUserRestriction(admin, it) } }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            runCatching { dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES_GLOBALLY) }
        }
        (store.hiddenByUs + SETTINGS_PACKAGES).forEach { runCatching { dpm.setApplicationHidden(admin, it, false) } }
        store.suspendedByUs.forEach { runCatching { dpm.setPackagesSuspended(admin,arrayOf(it),false) } }
        store.suspendedByUs=emptySet()
        store.hiddenByUs = emptySet()
        store.appliedWallpaperUrl = null
        runCatching { WebFilter.apply(context, store, WebFilter.fromPolicy(JSONObject())) }
    }

    companion object {
        private val wallpaperLock = Mutex()
        val SETTINGS_PACKAGES = setOf("com.android.settings")
    }
}

internal fun JSONObject.stringOrNull(key: String): String? =
    if (!has(key) || isNull(key)) null else optString(key).trim().ifEmpty { null }

internal fun JSONObject.stringSet(key: String): Set<String> {
    val array: JSONArray = optJSONArray(key) ?: return emptySet()
    return (0 until array.length()).mapNotNull { i -> array.optString(i).trim().ifEmpty { null } }.toSet()
}
