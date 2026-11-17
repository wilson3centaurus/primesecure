package com.robokorda.primesecure

import android.accounts.AccountManager
import android.app.admin.DevicePolicyManager
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Process
import android.os.UserManager
import android.provider.Settings
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Bounded, fixed diagnostic probes. No caller-supplied command or argument is ever executed. */
internal object DeviceDiagnosticCollector {
    data class Report(val text: String, val file: File)

    private data class Probe(val title: String, val command: List<String>, val filter: ((String) -> String)? = null)

    private val bootstrapKeys = listOf(
        "robokorda_owner_bootstrap_status",
        "robokorda_owner_run_id",
        "robokorda_owner_phase",
        "robokorda_owner_started_at",
        "robokorda_owner_finished_at",
        "robokorda_owner_identity",
        "robokorda_owner_selinux",
        "robokorda_owner_script",
        "robokorda_owner_package_path",
        "robokorda_owner_canonical_path",
        "robokorda_owner_expected_hash",
        "robokorda_owner_actual_hash",
        "robokorda_owner_setup_flags",
        "robokorda_owner_before",
        "robokorda_owner_dpm_exit",
        "robokorda_owner_dpm_result",
        "robokorda_owner_home_exit",
        "robokorda_owner_home_result",
        "robokorda_owner_home_resolved",
        "robokorda_owner_gate_exit",
        "robokorda_owner_gate_result",
        "robokorda_owner_monitor_heartbeat",
        "robokorda_owner_retry_nonce",
        "robokorda_owner_retry_seen",
    )

    fun collect(context: Context): Report {
        val out = StringBuilder(128 * 1024)
        fun section(title: String, body: () -> Any?) {
            out.append("\n===== ").append(title).append(" =====\n")
            out.append(runCatching { body()?.toString() ?: "(null)" }
                .getOrElse { "ERROR ${it.javaClass.name}: ${it.message.orEmpty().take(300)}" })
                .append('\n')
        }

        section("REPORT") {
            "generated_utc=${utcNow()}\nagent=${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})\n" +
                "android=${Build.VERSION.RELEASE} api=${Build.VERSION.SDK_INT}\nbuild_display=${Build.DISPLAY}"
        }
        section("PRIMESECURE PACKAGE") { packageState(context) }
        section("ANDROID MANAGEMENT") { managementState(context) }
        section("USER AND SETUP") { userState(context) }
        section("HOME") { homeState(context) }
        section("FIRMWARE BOOTSTRAP SETTINGS") {
            bootstrapKeys.joinToString("\n") { key ->
                "$key=${Settings.Global.getString(context.contentResolver, key) ?: "(unset)"}"
            }
        }
        section("NETWORK") { networkState(context) }
        section("PRIMESECURE BOOT EVENTS") { localEvents(context) }

        for (probe in probes(context)) {
            section("PROBE ${probe.title}") {
                val result = runProbe(probe.command)
                sanitize(probe.filter?.invoke(result) ?: result)
            }
        }

        val bounded = out.toString().take(1_000_000)
        val dir = File(context.filesDir, "diagnostics").apply { mkdirs() }
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())
        val file = File(dir, "primebook-v8-diagnostics-$stamp.txt")
        file.writeText(bounded)
        return Report(bounded, file)
    }

    @Suppress("DEPRECATION")
    private fun packageState(context: Context): String {
        val pm = context.packageManager
        val flags = PackageManager.GET_PERMISSIONS or PackageManager.GET_SIGNING_CERTIFICATES
        val info = pm.getPackageInfo(context.packageName, flags)
        val app = info.applicationInfo!!
        val appFlags = buildList {
            if (app.flags and ApplicationInfo.FLAG_SYSTEM != 0) add("SYSTEM")
            if (app.flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP != 0) add("UPDATED_SYSTEM_APP")
            if (app.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) add("DEBUGGABLE")
            if (app.flags and ApplicationInfo.FLAG_TEST_ONLY != 0) add("TEST_ONLY")
        }
        val signers = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners.orEmpty() else info.signatures.orEmpty()
        val signerHashes = signers.map { signature ->
            MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).joinToString("") { "%02X".format(it) }
        }
        val grants = info.requestedPermissions.orEmpty().mapIndexedNotNull { index, name ->
            val granted = info.requestedPermissionsFlags?.getOrNull(index)?.and(PackageInfoFlag.GRANTED) != 0
            if (name in setOf(
                    "android.permission.WRITE_SECURE_SETTINGS", "android.permission.DUMP",
                    "android.permission.READ_LOGS", "android.permission.GET_ACCOUNTS_PRIVILEGED",
                    "android.permission.START_ACTIVITIES_FROM_BACKGROUND"
                )) "$name=$granted" else null
        }
        return "package=${info.packageName}\nversion=${info.versionName} (${if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()})\n" +
            "uid=${app.uid} current_uid=${Process.myUid()} flags=${appFlags.joinToString().ifBlank { "none" }}\n" +
            "sourceDir=${app.sourceDir}\npublicSourceDir=${app.publicSourceDir}\nsigner_sha256=${signerHashes.joinToString()}\n" +
            grants.joinToString("\n")
    }

    private object PackageInfoFlag { const val GRANTED = 2 }

    private fun managementState(context: Context): String {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = AdminReceiver.component(context)
        val owners = dpm.activeAdmins.orEmpty().joinToString { it.flattenToShortString() }.ifBlank { "none" }
        val allowed = runCatching { dpm.isProvisioningAllowed(DevicePolicyManager.ACTION_PROVISION_MANAGED_DEVICE) }
            .fold({ it.toString() }, { "error:${it.javaClass.simpleName}" })
        return "is_device_owner=${dpm.isDeviceOwnerApp(context.packageName)}\n" +
            "admin_receiver_active=${dpm.isAdminActive(admin)}\nactive_admins=$owners\nmanaged_device_provisioning_allowed=$allowed"
    }

    private fun userState(context: Context): String {
        val users = context.getSystemService(UserManager::class.java)
        val r = users.userRestrictions.keySet().sorted().joinToString("\n") { "$it=${users.userRestrictions.get(it)}" }.ifBlank { "none" }
        val accountTypes = runCatching { AccountManager.get(context).accounts.map { it.type }.distinct().sorted() }
            .getOrElse { listOf("unavailable:${it.javaClass.simpleName}") }
        fun global(key: String) = Settings.Global.getString(context.contentResolver, key) ?: "(unset)"
        fun secure(key: String) = Settings.Secure.getString(context.contentResolver, key) ?: "(unset)"
        return "uid=${Process.myUid()} user_id=${Process.myUid() / 100000} system_user=${users.isSystemUser} managed_profile=${if (Build.VERSION.SDK_INT >= 30) users.isManagedProfile else "unknown"}\n" +
            "device_provisioned=${global(Settings.Global.DEVICE_PROVISIONED)}\nuser_setup_complete=${secure("user_setup_complete")}\n" +
            "development_settings_enabled=${global(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED)}\nadb_enabled=${global(Settings.Global.ADB_ENABLED)}\n" +
            "adb_wifi_enabled=${global("adb_wifi_enabled")}\ndebugging_restricted=${users.hasUserRestriction(UserManager.DISALLOW_DEBUGGING_FEATURES)}\n" +
            "account_types=${accountTypes.joinToString().ifBlank { "none" }}\nrestrictions:\n$r"
    }

    private fun homeState(context: Context): String {
        val intent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            addCategory(Intent.CATEGORY_DEFAULT)
        }
        val resolved = context.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo
            ?.let { "${it.packageName}/${it.name}" } ?: "none"
        val candidates = context.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DISABLED_COMPONENTS)
            .map { "${it.activityInfo.packageName}/${it.activityInfo.name} enabled=${it.activityInfo.enabled}" }.distinct().sorted()
        val role = if (Build.VERSION.SDK_INT >= 29) runCatching {
            context.getSystemService(RoleManager::class.java).let {
                "available=${it.isRoleAvailable(RoleManager.ROLE_HOME)} held_by_primesecure=${it.isRoleHeld(RoleManager.ROLE_HOME)}"
            }
        }.getOrElse { "error:${it.javaClass.simpleName}" } else "unsupported"
        return "resolved=$resolved\nrole=$role\ncandidates:\n${candidates.joinToString("\n").ifBlank { "none" }}"
    }

    private fun networkState(context: Context): String {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        val active = cm.activeNetwork
        val caps = active?.let(cm::getNetworkCapabilities)
        val wifi = context.applicationContext.getSystemService(WifiManager::class.java)
        @Suppress("DEPRECATION") val ip = wifi.connectionInfo?.ipAddress ?: 0
        val ipText = listOf(ip and 255, ip shr 8 and 255, ip shr 16 and 255, ip shr 24 and 255).joinToString(".")
        return "active_network=${active != null}\nvalidated=${caps?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED)}\n" +
            "wifi_enabled=${wifi.isWifiEnabled}\nwifi_ip=$ipText"
    }

    private fun localEvents(context: Context): String {
        val store = AgentStore(context)
        val events = DeviceLog.batch(context, store.deviceId.takeIf { store.isEnrolled }, 200)
        return (0 until events.length()).joinToString("\n") { events.getJSONObject(it).toString() }.ifBlank { "none" }
    }

    private fun probes(context: Context): List<Probe> {
        val pkg = context.packageName
        return listOf(
            Probe("identity", listOf("/system/bin/id")),
            Probe("selinux", listOf("/system/bin/getenforce")),
            Probe("build display property", listOf("/system/bin/getprop", "ro.build.display.id")),
            Probe("RoboKorda build property", listOf("/system/bin/getprop", "ro.robokorda.build")),
            Probe("boot completed property", listOf("/system/bin/getprop", "sys.boot_completed")),
            Probe("init owner service", listOf("/system/bin/getprop", "init.svc.robokorda_primesecure_owner_v8diag")),
            Probe("device policy", listOf("/system/bin/dumpsys", "device_policy")),
            Probe("activity tasks and windowing modes", listOf("/system/bin/dumpsys", "activity", "activities")),
            Probe("activity recents and task bounds", listOf("/system/bin/dumpsys", "activity", "recents")),
            Probe("window manager windows", listOf("/system/bin/dumpsys", "window", "windows")),
            Probe("window manager policy", listOf("/system/bin/dumpsys", "window", "policy")),
            Probe("PrimeOS freeform setting", listOf("/system/bin/settings", "get", "global", "enable_freeform_support")),
            Probe("force resizable setting", listOf("/system/bin/settings", "get", "global", "force_resizable_activities")),
            Probe("development freeform setting", listOf("/system/bin/settings", "get", "global", "development_enable_freeform_windows")),
            Probe("users", listOf("/system/bin/dumpsys", "user")),
            Probe("PrimeSecure package", listOf("/system/bin/dumpsys", "package", pkg)),
            Probe("roles", listOf("/system/bin/dumpsys", "role")),
            Probe("HOME resolver", listOf("/system/bin/cmd", "package", "resolve-activity", "--brief", "--user", "0", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.HOME", "-c", "android.intent.category.DEFAULT")),
            Probe("firmware files", listOf("/system/bin/ls", "-lZ", "/system/etc/init/robokorda-primesecure-owner-v8diag.rc", "/system/bin/primesecure-owner-bootstrap-v8diag.sh")),
            Probe("selected system logs", listOf("/system/bin/logcat", "-d", "-v", "threadtime", "-t", "2500")) { raw ->
                raw.lineSequence().filter { line ->
                    listOf("RoboKordaOwner", "PrimeSecure", "DevicePolicy", "PackageManager", "avc: denied", " init:").any(line::contains)
                }.toList().takeLast(800).joinToString("\n")
            },
        )
    }

    private fun runProbe(command: List<String>): String {
        val process = ProcessBuilder(command).redirectErrorStream(true).start()
        val executor = Executors.newSingleThreadExecutor()
        val future = executor.submit<String> {
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(4096)
            process.inputStream.use { input ->
                while (output.size() < 262_144) {
                    val count = input.read(buffer, 0, minOf(buffer.size, 262_144 - output.size()))
                    if (count < 0) break
                    output.write(buffer, 0, count)
                }
            }
            output.toString(Charsets.UTF_8.name())
        }
        val finished = process.waitFor(10, TimeUnit.SECONDS)
        if (!finished) process.destroyForcibly()
        val output = runCatching { future.get(2, TimeUnit.SECONDS) }.getOrElse { "reader_error=${it.javaClass.simpleName}" }
        executor.shutdownNow()
        return "command=${command.joinToString(" ")}\nfinished=$finished exit=${if (finished) process.exitValue() else "timeout"}\n$output"
    }

    private fun sanitize(value: String): String = value
        .replace(Regex("(?i)(https?://[^\\s?]+)\\?[^\\s]+"), "$1?[redacted]")
        .replace(Regex("(?i)\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b"), "[email-redacted]")
        .replace(Regex("(?i)(access_token|refresh_token|authorization|apikey|anon_key)[=: ]+[^\\s,}]+"), "$1=[redacted]")
        .take(262_144)

    private fun utcNow(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }.format(Date())
}
