package com.robokorda.primesecure

import android.app.WallpaperManager
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.os.Build
import android.os.UserManager
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
    var lastProblems: List<String> = listOf("Device management has not been applied yet.")
        private set

    /**
     * Returns a short human-readable summary of the resulting state. While
     * [suspended], only the policy's allowed apps stay usable (none if empty).
     */
    suspend fun apply(policy: JSONObject, suspended: Boolean = false): String =
        policyQueue.apply({ policy }) { withContext(Dispatchers.IO) { applyUnlocked(it, suspended) } }

    /** Loading inside the queue prevents an old boot task from overwriting a fresh check-in. */
    suspend fun applyCached(): String? = policyQueue.apply({
        val prefs = context.getSharedPreferences("agent-policy", Context.MODE_PRIVATE)
        prefs.getString("policy", null)?.takeIf { prefs.getString("device", null) == store.deviceId }
    }) { saved -> saved?.let { withContext(Dispatchers.IO) { applyUnlocked(JSONObject(it), store.lastStatus == "suspended") } } }

    private suspend fun applyUnlocked(policy: JSONObject, suspended: Boolean): String {
        if (!AdminReceiver.isDeviceOwner(context)) return "Not Device Owner — policy not applied"

        val problems = mutableListOf<String>()
        dpm.setUninstallBlocked(admin, context.packageName, true)
        fun attempt(what: String, block: () -> Unit) {
            try {
                block()
            } catch (e: Exception) {
                DeviceLog.event(context,"error","policy","operation_failed",e,JSONObject().put("phase",what.replace(' ','_')))
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
                DeviceLog.event(context,"error","wallpaper","wallpaper_failed",e)
                problems += "wallpaper: ${e.javaClass.simpleName}: ${e.message}"
            }
        }
        if (wallpaperUrl == null) store.appliedWallpaperUrl = null

        attempt("lock wallpaper") { restrict(UserManager.DISALLOW_SET_WALLPAPER, lockWallpaper) }
        val management=policy.optJSONObject("hub_management") ?: JSONObject()
        val settingsLock=management.optBoolean("lock_device_settings")&&!DeviceSafety.paused(context)
        attempt("settings lockdown") { problems+=DeviceSettingsLockdown.apply(context,management) }
        attempt("USB and SD storage") { restrict(UserManager.DISALLOW_MOUNT_PHYSICAL_MEDIA,management.optBoolean("block_usb_storage")) }
        attempt("USB file transfer") { restrict(UserManager.DISALLOW_USB_FILE_TRANSFER,management.optBoolean("block_usb_transfer")) }
        attempt("Bluetooth file sharing") { restrict(UserManager.DISALLOW_BLUETOOTH_SHARING, management.optBoolean("block_bluetooth_transfer")) }
        attempt("Bluetooth") { restrict(UserManager.DISALLOW_BLUETOOTH, management.optBoolean("block_bluetooth")) }
        attempt("Bluetooth configuration") { restrict(UserManager.DISALLOW_CONFIG_BLUETOOTH, management.optBoolean("block_bluetooth")) }
        attempt("new users and guests") { restrict(UserManager.DISALLOW_ADD_USER, settingsLock||management.optBoolean("block_add_users")) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            attempt("user switching") { restrict(UserManager.DISALLOW_USER_SWITCH, settingsLock||management.optBoolean("block_user_switch")) }
        }
        attempt("Settings factory reset") { restrict(UserManager.DISALLOW_FACTORY_RESET, settingsLock||management.optBoolean("block_factory_reset")) }
        attempt("block installs") {
            restrict(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES, blockInstalls||settingsLock)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                restrict(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES_GLOBALLY, blockInstalls||settingsLock)
            }
        }

        var hiddenCount = 0
        attempt("app visibility") {
            hiddenCount = applyAppVisibility(
                hidden = policy.stringSet("hidden_apps") + management.stringSet("blocked_packages") +
                    if(management.optBoolean("hide_file_managers")) fileManagerPackages() else emptySet(),
                allowed = policy.stringSet("allowed_apps"),
                hideSettings = hideSettings || suspended,
                allowListOnly = suspended || management.optBoolean("approved_apps_only"),
            )
        }

        hiddenCount=store.hiddenByUs.size+store.suspendedByUs.size
        attempt("required app protection") { applyRequiredApps() }
        attempt("preferred viewers") { PreferredViewers.apply(context,management) }
        var webSummary = ""
        attempt("web filter") { webSummary = WebFilter.apply(context, store, WebFilter.fromPolicy(policy)) }

        val summary = buildString {
            if (suspended) append("SUSPENDED · ")
            append("Policy: ").append(policy.optString("scope", "none"))
            append(" · wallpaper ").append(if (wallpaperUrl != null) "set" else "unmanaged")
            if (lockWallpaper) append(" (locked)")
            append(" · installs ").append(if (blockInstalls) "blocked" else "allowed")
            append(" · settings visible (login safety)")
            append(" · $hiddenCount app(s) hidden")
            if (webSummary.isNotEmpty()) append(" · ").append(webSummary)
            problems.forEach { append("\n⚠ ").append(it) }
        }
        lastProblems = problems.toList()
        DeviceLog.state(context,"policy","policy","policy_applied",JSONObject()
            .put("strict",management.optBoolean("approved_apps_only")).put("hidden",store.hiddenByUs.size).put("suspended",store.suspendedByUs.size))
        return summary
    }

    private fun restrict(key: String, on: Boolean) {
        if (on) dpm.addUserRestriction(admin, key) else dpm.clearUserRestriction(admin, key)
    }

    private fun applyRequiredApps() {
        val hub=HubStore(context)
        val wanted=InitialSetup.requiredApps(hub.catalog,hub.items()).map { it.optString("package_name") }.filter { it.isNotBlank() }.toSet() + context.packageName
        val prefs=context.getSharedPreferences("required-app-protection",Context.MODE_PRIVATE)
        val previous=prefs.getStringSet("packages",emptySet())!!.toSet()
        val remaining=mutableSetOf<String>()
        // Journal before applying, so a terminated process can still undo an old default.
        check(prefs.edit().putStringSet("packages",previous+wanted).commit())
        for(pkg in previous-wanted) {
            if(runCatching { dpm.setUninstallBlocked(admin,pkg,false) }.isFailure)remaining+=pkg
        }
        for(pkg in wanted) {
            if(runCatching { pm.getApplicationInfo(pkg,0) }.isSuccess) {
                dpm.setUninstallBlocked(admin,pkg,true)
                remaining+=pkg
            }
        }
        check(prefs.edit().putStringSet("packages",remaining).commit())
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
        val userUnlocked=context.getSystemService(UserManager::class.java).isUserUnlocked
        val screenUnlocked=!context.getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked
        val uptime=android.os.SystemClock.elapsedRealtime()
        val paused=DeviceSafety.paused(context)
        val explicit=if(paused) emptySet() else ManualAppHides.expanded(hidden)
        val essential=AppSafety.essentialPackages(context)
        val exceptions=ManualAppHides.firmwareExceptions(if(paused) emptySet() else hidden,essential,userUnlocked,screenUnlocked,uptime)
        val allProtected=AppSafety.protectedPackages(context)
        val protected = allProtected-exceptions
        @Suppress("DEPRECATION")
        val installed=pm.getInstalledApplications(android.content.pm.PackageManager.MATCH_UNINSTALLED_PACKAGES).map { it.packageName }.toSet()

        val want = AppVisibilityRules.hiddenPackages(
            requested = (explicit + if (hideSettings && !paused) SETTINGS_PACKAGES else emptySet()).intersect(installed),
            allowed = if(paused) emptySet() else allowed, launchable = launchablePackages(),
            previouslyRestricted = previouslyHidden + previouslySuspended,
            protected = protected, allowListOnly = allowListOnly && !paused,
        )

        val nowHidden = mutableSetOf<String>()
        val nowSuspended = mutableSetOf<String>()
        val failures = mutableListOf<String>()
        // Journal our intent before Android state changes. A process death must not
        // leave a hidden app absent from the list we use to undo restrictions.
        store.saveAppRestrictions(previouslyHidden + want, previouslySuspended + want)
        for (pkg in want) {
            if(pkg !in previouslyHidden && pkg !in previouslySuspended)
                DeviceLog.record(context,"info","policy","app_restriction_planned",details=JSONObject().put("package",pkg))
            val hiddenOk=runCatching { dpm.isApplicationHidden(admin,pkg) || dpm.setApplicationHidden(admin,pkg,true) }.getOrDefault(false)
            if(hiddenOk) {
                nowHidden+=pkg
                if(pkg !in previouslyHidden)DeviceLog.event(context,"info","policy","app_hidden",details=JSONObject().put("package",pkg))
            }
            else if(runCatching { dpm.setPackagesSuspended(admin,arrayOf(pkg),true).isEmpty() }.getOrDefault(false)) nowSuspended+=pkg
            else failures+=pkg
        }
        for (pkg in previouslyHidden - want) {
            if (!runCatching { !dpm.isApplicationHidden(admin,pkg) || dpm.setApplicationHidden(admin,pkg,false) }.getOrDefault(false)) {
                nowHidden += pkg
                failures += "restore visibility: $pkg"
            }
        }
        for (pkg in previouslySuspended - nowSuspended.toSet()) {
            if (!runCatching { !dpm.isPackageSuspended(admin,pkg) || dpm.setPackagesSuspended(admin,arrayOf(pkg),false).isEmpty() }.getOrDefault(false)) {
                nowSuspended += pkg
                failures += "remove suspension: $pkg"
            }
        }
        store.saveAppRestrictions(nowHidden, nowSuspended)
        val outcomes=JSONArray((explicit + if(hideSettings) SETTINGS_PACKAGES else emptySet()).sorted().map { pkg ->
            JSONObject().put("package",pkg).put("protection_reason",if(pkg in essential) AppSafety.protectionReason(context,pkg) else JSONObject.NULL).put("status",when {
                pkg !in installed -> "not_installed"
                pkg in nowHidden -> "hidden"
                pkg in nowSuspended -> "suspended"
                pkg in essential -> "protected"
                pkg in allProtected && pkg in ManualAppHides.groups.values.flatten() && (!userUnlocked||!screenUnlocked||uptime<120_000) -> "waiting_for_unlock"
                pkg in protected -> "protected"
                else -> "rejected"
            })
        })
        context.getSharedPreferences("app-visibility-report",Context.MODE_PRIVATE).edit().putString("device",store.deviceId).putString("outcomes",outcomes.toString()).putLong("updated",System.currentTimeMillis()).commit()
        check(failures.isEmpty()) { "Android app restriction failures: ${failures.joinToString()}" }
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

    /** Called from the debug "release" button and, later, the retire command. */
    fun undoAll() {
        runCatching { PreferredViewers.clear(context) }
        val requiredPrefs=context.getSharedPreferences("required-app-protection",Context.MODE_PRIVATE)
        requiredPrefs.getStringSet("packages",emptySet())!!.toSet().forEach { pkg -> runCatching { dpm.setUninstallBlocked(admin,pkg,false) } }
        requiredPrefs.edit().clear().commit()
        runCatching { dpm.setUninstallBlocked(admin, context.packageName, false) }
        listOf(
            UserManager.DISALLOW_SET_WALLPAPER,
            UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES,
            UserManager.DISALLOW_USB_FILE_TRANSFER,
            UserManager.DISALLOW_MOUNT_PHYSICAL_MEDIA,
            UserManager.DISALLOW_BLUETOOTH_SHARING,
            UserManager.DISALLOW_BLUETOOTH,
            UserManager.DISALLOW_CONFIG_BLUETOOTH,
            UserManager.DISALLOW_ADD_USER,
            UserManager.DISALLOW_FACTORY_RESET,
        ).forEach { runCatching { dpm.clearUserRestriction(admin, it) } }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            runCatching { dpm.clearUserRestriction(admin, UserManager.DISALLOW_USER_SWITCH) }
        }
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
        private val policyQueue = PolicyQueue()
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
