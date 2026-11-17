package com.robokorda.primesecure

import android.Manifest
import android.app.Activity
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.UserManager
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import org.json.JSONObject

/** Local first-boot safety boundary. It does not depend on a server response. */
internal object SetupGatePolicy {
    private const val PREFS = "setup-gate-state"
    private const val PRIMEOS_LAUNCHER = "com.android.launcher3"
    private const val PRIMEOS_FULLSCREEN_SUFFIX = "_full"

    val restrictions: Set<String> = buildSet {
        add(UserManager.DISALLOW_MOUNT_PHYSICAL_MEDIA)
        add(UserManager.DISALLOW_USB_FILE_TRANSFER)
        add(UserManager.DISALLOW_BLUETOOTH_SHARING)
        add(UserManager.DISALLOW_BLUETOOTH)
        add(UserManager.DISALLOW_CONFIG_BLUETOOTH)
        add(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            add(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES_GLOBALLY)
        }
    }

    /** Controls which remain after enrollment without disabling Settings itself. */
    private val managedStudentRestrictions: Set<String> = buildSet {
        add(UserManager.DISALLOW_MOUNT_PHYSICAL_MEDIA)
        add(UserManager.DISALLOW_USB_FILE_TRANSFER)
        add(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES)
        add(UserManager.DISALLOW_ADD_USER)
        add(UserManager.DISALLOW_FACTORY_RESET)
        add(UserManager.DISALLOW_SAFE_BOOT)
        // DISALLOW_DEBUGGING_FEATURES is deliberately NOT here: it is governed only by
        // the dashboard "Disable developer and ADB debugging" toggle and emergency pause
        // (DeviceSettingsLockdown). Adding it here overrode that toggle permanently.
        add(UserManager.DISALLOW_SET_WALLPAPER)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) add(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES_GLOBALLY)
    }

    /** Bluetooth is setup-blocked, then deliberately restored for managed student use. */
    private val setupOnlyRestrictions = setOf(
        UserManager.DISALLOW_BLUETOOTH_SHARING,
        UserManager.DISALLOW_BLUETOOTH,
        UserManager.DISALLOW_CONFIG_BLUETOOTH,
    )

    fun offlineTestComplete(context: Context): Boolean =
        BuildConfig.FIRST_BOOT_TEST_MODE && FirstBootTestStore(context).deviceSetupComplete

    fun setupComplete(context: Context): Boolean = AgentStore(context).isEnrolled || offlineTestComplete(context)

    fun applyOfflineBaseline(context: Context) {
        ensurePrimeOsFullscreen(context)
        if (!AdminReceiver.isDeviceOwner(context) || setupComplete(context)) return
        val dpm = AdminReceiver.dpm(context)
        val admin = AdminReceiver.component(context)
        runCatching { dpm.setUninstallBlocked(admin, context.packageName, true) }
        restrictions.forEach { restriction -> runCatching { dpm.addUserRestriction(admin, restriction) } }
        runCatching {
            dpm.setPermissionGrantState(
                admin,
                context.packageName,
                Manifest.permission.ACCESS_FINE_LOCATION,
                DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED,
            )
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            runCatching {
                dpm.setPermissionGrantState(
                    admin,
                    context.packageName,
                    Manifest.permission.NEARBY_WIFI_DEVICES,
                    DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED,
                )
            }
        }
        ManualAppHides.safeSystemHides.forEach { pkg ->
            if (runCatching { context.packageManager.getApplicationInfo(pkg, 0) }.isSuccess) {
                runCatching { dpm.setApplicationHidden(admin, pkg, true) }
            }
        }
        // PrimeOS implements the Super app drawer as a privileged Launcher3
        // overlay. Android lock task cannot constrain that surface, so hide
        // Launcher3 only while mandatory setup is active. The RoboKorda PrimeOS
        // firmware separately excludes this package from its system caption.
        runCatching { dpm.setApplicationHidden(admin, PRIMEOS_LAUNCHER, true) }
    }

    /**
     * PrimeOS's ActivityStarter checks this OEM global setting before it creates
     * a task. Without it, PrimeOS overrides the manifest and forces an ordinary
     * landscape activity into its remembered freeform bounds.
     */
    private fun ensurePrimeOsFullscreen(context: Context) {
        runCatching {
            Settings.Global.putInt(
                context.contentResolver,
                context.packageName + PRIMEOS_FULLSCREEN_SUFFIX,
                1,
            )
        }.onFailure { record(context, "primeos_fullscreen_setting", it) }
    }

    fun enter(activity: Activity) {
        if (setupComplete(activity)) return
        configureLikeRequiredNotice(activity)
        applyOfflineBaseline(activity.applicationContext)
        if (!AdminReceiver.isDeviceOwner(activity)) return
        val dpm = AdminReceiver.dpm(activity)
        val admin = AdminReceiver.component(activity)
        val result = runCatching {
            dpm.setLockTaskPackages(admin, arrayOf(activity.packageName))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS)
            }
            val am = activity.getSystemService(ActivityManager::class.java)
            if (am.lockTaskModeState == ActivityManager.LOCK_TASK_MODE_NONE) activity.startLockTask()
        }
        record(activity, "activity_enter", result.exceptionOrNull())
    }

    /** Uses the same path as a required school notice, which PrimeOS displays fixed/full-screen. */
    fun launchGate(context: Context, reason: String): Boolean {
        if (setupComplete(context)) return false
        applyOfflineBaseline(context)
        val owner = AdminReceiver.isDeviceOwner(context)
        val permitted = if (owner) runCatching {
            val dpm = AdminReceiver.dpm(context)
            val admin = AdminReceiver.component(context)
            dpm.setLockTaskPackages(admin, arrayOf(context.packageName))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS)
            }
            dpm.isLockTaskPermitted(context.packageName)
        }.getOrDefault(false) else false

        Notifications.setupGate(context, reason)
        val intent = Intent(context, SetupGateActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("launch_reason", reason)
        val result = runCatching { context.startActivity(intent) }
        record(context, "launch:$reason:owner=$owner:permitted=$permitted", result.exceptionOrNull())
        return result.isSuccess
    }

    fun completeSetup(activity: Activity) {
        if (offlineTestComplete(activity)) {
            releaseToPrimeOs(activity)
            return
        }
        Notifications.cancelSetupGate(activity)
        applyManagedStudentBaseline(activity)
        restorePrimeOsLauncher(activity)
        reconcileAfterEnrollment(activity)
        activity.startActivity(
            Intent(activity, SchoolLauncherActivity::class.java).addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK,
            ),
        )
        activity.finishAndRemoveTask()
    }

    fun completeOfflineTest(activity: Activity) {
        check(BuildConfig.FIRST_BOOT_TEST_MODE)
        FirstBootTestStore(activity).deviceSetupComplete = true
        releaseToPrimeOs(activity)
    }

    fun releaseToPrimeOs(activity: Activity) {
        Notifications.cancelSetupGate(activity)
        applyManagedStudentBaseline(activity)
        OfflineSetupNotice.refresh(activity)
        restorePrimeOsLauncher(activity)
        val am = activity.getSystemService(ActivityManager::class.java)
        if (am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE) runCatching { activity.stopLockTask() }
        // This PrimeOS image's vendor Quickstep launcher crashes because its APK
        // calls INPUT_CONSUMER APIs without requesting that privileged permission.
        // Keep the Device-Owner-authorised SchoolLauncher as HOME; after setup it
        // becomes the normal managed desktop instead of the mandatory gate.
        SchoolSetupHome.makePreferred(activity)
        activity.startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
    }

    fun record(context: Context, phase: String, error: Throwable? = null) {
        val am = context.getSystemService(ActivityManager::class.java)
        val details = JSONObject()
            .put("phase", phase)
            .put("lock_task_state", am.lockTaskModeState)
            .put("device_owner", AdminReceiver.isDeviceOwner(context))
            .put("enrolled", AgentStore(context).isEnrolled)
        if (AdminReceiver.isDeviceOwner(context)) {
            val dpm = AdminReceiver.dpm(context)
            details.put("lock_task_permitted", runCatching { dpm.isLockTaskPermitted(context.packageName) }.getOrDefault(false))
            details.put("lock_task_packages", runCatching { dpm.getLockTaskPackages(AdminReceiver.component(context)).joinToString() }.getOrDefault(""))
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putLong("last_at", System.currentTimeMillis())
            .putString("last_phase", phase)
            .putString("last_error", error?.let { "${it.javaClass.simpleName}: ${it.message}" })
            .apply()
        DeviceLog.record(context, if (error == null) "info" else "error", "setup_gate", "setup_gate_state", error, details)
    }

    fun reconcileAfterEnrollment(activity: Activity) {
        if (!AgentStore(activity).isEnrolled || AgentStore(activity).lastStatus == "locked") return
        applyManagedStudentBaseline(activity)
        restorePrimeOsLauncher(activity)
        val am = activity.getSystemService(ActivityManager::class.java)
        if (am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE) runCatching { activity.stopLockTask() }
        leaveSetupFullscreen(activity)
    }

    fun applyManagedStudentBaseline(context: Context) {
        if (!AdminReceiver.isDeviceOwner(context) || !setupComplete(context)) return
        val dpm = AdminReceiver.dpm(context)
        val admin = AdminReceiver.component(context)
        managedStudentRestrictions.forEach { runCatching { dpm.addUserRestriction(admin, it) } }
        setupOnlyRestrictions.forEach { runCatching { dpm.clearUserRestriction(admin, it) } }
        // Agents <= 71 added the debugging restriction here outside the dashboard toggle's
        // journal, so turning the toggle off could never release it. Release that copy.
        if (!DeviceSettingsLockdown.owns(context, UserManager.DISALLOW_DEBUGGING_FEATURES)) {
            runCatching { dpm.clearUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES) }
        }
        ManualAppHides.safeSystemHides.forEach { pkg ->
            if (runCatching { context.packageManager.getApplicationInfo(pkg, PackageManager.MATCH_UNINSTALLED_PACKAGES) }.isSuccess) {
                runCatching { dpm.setApplicationHidden(admin, pkg, true) }
            }
        }
        record(context, "managed_student_baseline")
    }

    fun leaveSetupFullscreen(activity: Activity) {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        @Suppress("DEPRECATION")
        run {
            activity.window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        }
    }

    private fun restorePrimeOsLauncher(context: Context) {
        if (!AdminReceiver.isDeviceOwner(context)) return
        runCatching {
            AdminReceiver.dpm(context).setApplicationHidden(
                AdminReceiver.component(context),
                PRIMEOS_LAUNCHER,
                false,
            )
        }
    }

    fun forceFullscreen(activity: Activity) {
        if (setupComplete(activity)) return
        activity.window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
        )
        activity.window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        @Suppress("DEPRECATION")
        activity.window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
    }

    fun configureLikeRequiredNotice(activity: Activity) {
        if (setupComplete(activity)) return
        activity.setFinishOnTouchOutside(false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            activity.setShowWhenLocked(true)
            activity.setTurnScreenOn(true)
        }
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // PrimeOS starts ordinary activities in its remembered freeform bounds.
        // Reassert the setup window shape on every focus/resume before lock task
        // begins so the caption cannot briefly expose close/minimise controls.
        forceFullscreen(activity)
    }

}
