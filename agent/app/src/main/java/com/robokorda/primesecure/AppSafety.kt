package com.robokorda.primesecure

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.provider.Settings
import android.util.Log
import android.webkit.WebView

/** OEM login dependencies are not reliably discoverable from launcher roles alone. */
internal object AppSafety {
    private const val TAG = "PrimeSecureAppSafety"
    private const val KNOWN_CORE = "android,com.android.systemui,com.android.settings,com.android.providers.settings,com.android.webview,com.google.android.webview,com.android.permissioncontroller,com.google.android.permissioncontroller"

    @Suppress("DEPRECATION")
    fun essentialPackages(context: Context): Set<String> = buildSet {
        val pm = context.packageManager
        add(context.packageName)
        addAll(KNOWN_CORE.split(','))
        val flags = PackageManager.MATCH_UNINSTALLED_PACKAGES or PackageManager.MATCH_DISABLED_COMPONENTS or
            PackageManager.MATCH_DIRECT_BOOT_AWARE or PackageManager.MATCH_DIRECT_BOOT_UNAWARE
        // Search apps can advertise an optional HOME activity without providing
        // this device's desktop. Protect the selected home, not every candidate.
        val homes=pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), flags)
            .map { it.activityInfo.packageName }.toSet()
        val selected=pm.resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName
        addAll(ActiveRoleSafety.protectedPackages(selected,homes))
        val keyboards=pm.queryIntentServices(Intent("android.view.InputMethod"), flags).map {it.serviceInfo.packageName}.toSet()
        val selectedKeyboard=Settings.Secure.getString(context.contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)?.substringBefore('/')?.takeIf {it.isNotBlank()}
        addAll(ActiveRoleSafety.protectedPackages(selectedKeyboard,keyboards))
        selectedKeyboard?.let(::add)
        runCatching { WebView.getCurrentWebViewPackage()?.packageName }.getOrNull()?.let(::add)
        AdminReceiver.dpm(context).activeAdmins?.forEach { add(it.packageName) }
    }

    @Suppress("DEPRECATION")
    fun protectedPackages(context:Context):Set<String> = essentialPackages(context) + context.packageManager
        .getInstalledApplications(PackageManager.MATCH_UNINSTALLED_PACKAGES).filter {
            it.flags and (ApplicationInfo.FLAG_SYSTEM or ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)!=0
        }.map { it.packageName }

    fun protectionReason(context:Context,pkg:String):String = when {
        pkg=="com.android.settings" -> "PrimeOS Settings and login safety"
        pkg==context.packageName -> "PrimeSecure device owner"
        pkg==context.packageManager.resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME),PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName -> "Selected home-screen launcher"
        pkg==Settings.Secure.getString(context.contentResolver,Settings.Secure.DEFAULT_INPUT_METHOD)?.substringBefore('/') -> "Selected keyboard / input method"
        pkg==runCatching {WebView.getCurrentWebViewPackage()?.packageName}.getOrNull() -> "Active Android WebView"
        else -> "Core Android, active administrator, or unresolved home / keyboard role"
    }

    /** Uses no credential-encrypted agent files: safe before the first unlock. */
    @Synchronized
    fun restoreEssentialApps(context: Context) {
        if (!AdminReceiver.isDeviceOwner(context)) return
        val dpm = AdminReceiver.dpm(context)
        val admin = AdminReceiver.component(context)
        for (pkg in protectedPackages(context)) {
            runCatching {
                if (dpm.isApplicationHidden(admin, pkg)) {
                    check(dpm.setApplicationHidden(admin, pkg, false)) { "Android refused to restore $pkg" }
                    Log.i(TAG, "Restored hidden essential package $pkg")
                }
            }.onFailure { Log.w(TAG, "Essential visibility repair: $pkg", it) }
            runCatching {
                if (dpm.isPackageSuspended(admin, pkg)) {
                    check(dpm.setPackagesSuspended(admin, arrayOf(pkg), false).isEmpty())
                    Log.i(TAG, "Removed agent suspension from essential package $pkg")
                }
            }.onFailure { Log.w(TAG, "Essential suspension repair: $pkg", it) }
        }
    }
}
