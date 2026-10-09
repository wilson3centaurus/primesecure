package com.robokorda.primesecure

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.os.Build
import android.os.UserManager
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import java.io.File
import java.util.UUID
import kotlin.coroutines.resume

/** Silent install / uninstall, which PackageInstaller allows the Device Owner without prompting. */
class AppInstaller(private val context: Context, private val store: AgentStore) {

    private val pm = context.packageManager
    private val dpm = AdminReceiver.dpm(context)
    private val admin = AdminReceiver.component(context)

    suspend fun install(commandId: String, payload: JSONObject): JSONObject {
        val path = payload.stringOrNull("storage_path") ?: throw IllegalArgumentException("no storage_path")
        val apk = File(context.cacheDir, "install-$commandId.apk")
        try {
            SupabaseApi(store).download("/storage/v1/object/apks/$path", apk)
            val info = archiveInfo(apk)
            if (info.packageName == context.packageName) throw IllegalArgumentException("use the agent update instead")
            installFile(apk, info.packageName)
            return JSONObject()
                .put("package", info.packageName)
                .put("version", info.versionName ?: JSONObject.NULL)
        } finally {
            apk.delete()
        }
    }

    fun archiveInfo(apk: File): android.content.pm.PackageInfo {
        @Suppress("DEPRECATION")
        return pm.getPackageArchiveInfo(apk.path, 0) ?: throw IllegalArgumentException("not a valid APK")
    }

    /** Installs (or updates) [apk] silently; suspends until PackageInstaller reports back. */
    suspend fun installFile(apk: File, packageName: String) {
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(packageName)
        params.setSize(apk.length())
        val installer = pm.packageInstaller
        val sessionId = installer.createSession(params)
        withUnknownSourcesAllowed {
            installer.openSession(sessionId).use { session ->
                apk.inputStream().use { input ->
                    session.openWrite("base.apk", 0, apk.length()).use { output ->
                        input.copyTo(output)
                        session.fsync(output)
                    }
                }
                awaitResult("install-$sessionId") { sender -> session.commit(sender) }
            }
        }
    }

    suspend fun uninstall(payload: JSONObject): JSONObject {
        val pkg = payload.stringOrNull("package") ?: throw IllegalArgumentException("no package")
        if (pkg == context.packageName) throw IllegalArgumentException("can't remove PrimeSecure itself")
        val installed = runCatching { pm.getPackageInfo(pkg, 0) }.isSuccess
        if (!installed) return JSONObject().put("package", pkg).put("note", "was not installed")
        // A hidden app can't be uninstalled; unhide first (policy re-hides anything still wanted).
        runCatching { dpm.setApplicationHidden(admin, pkg, false) }
        awaitResult("uninstall-$pkg") { sender -> pm.packageInstaller.uninstall(pkg, sender) }
        return JSONObject().put("package", pkg)
    }

    /** block_installs sets the unknown-sources restriction; lift it just for our own session. */
    private suspend fun <T> withUnknownSourcesAllowed(block: suspend () -> T): T {
        val keys = buildList {
            add(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) add(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES_GLOBALLY)
        }
        val active = keys.filter { dpm.getUserRestrictions(admin).getBoolean(it) }
        active.forEach { dpm.clearUserRestriction(admin, it) }
        try {
            return block()
        } finally {
            active.forEach { dpm.addUserRestriction(admin, it) }
        }
    }

    /** Runs [start] with an IntentSender and waits for PackageInstaller's verdict. */
    private suspend fun awaitResult(tag: String, start: (android.content.IntentSender) -> Unit) {
        // Before Android 13 a dynamic receiver is exported; an unguessable action keeps other
        // apps from forging a result. Only PackageInstaller, via our PendingIntent, knows it.
        val action = "${context.packageName}.PACKAGE_RESULT.$tag.${UUID.randomUUID()}"
        val (status, message) = withTimeout(10 * 60_000) {
            suspendCancellableCoroutine { cont ->
                val receiver = object : BroadcastReceiver() {
                    override fun onReceive(c: Context, intent: Intent) {
                        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
                        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) return // not expected for Device Owner
                        runCatching { context.unregisterReceiver(this) }
                        if (cont.isActive) cont.resume(status to intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
                    }
                }
                val filter = IntentFilter(action)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
                } else {
                    @Suppress("UnspecifiedRegisterReceiverFlag")
                    context.registerReceiver(receiver, filter)
                }
                cont.invokeOnCancellation { runCatching { context.unregisterReceiver(receiver) } }

                // Mutable: the installer adds the status extras to our intent.
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                    (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
                val pending = PendingIntent.getBroadcast(
                    context, tag.hashCode(), Intent(action).setPackage(context.packageName), flags,
                )
                try {
                    start(pending.intentSender)
                } catch (e: Exception) {
                    runCatching { context.unregisterReceiver(receiver) }
                    if (cont.isActive) cont.resume(PackageInstaller.STATUS_FAILURE to (e.message ?: e.javaClass.simpleName))
                }
            }
        }
        if (status != PackageInstaller.STATUS_SUCCESS) error(message ?: "failed with status $status")
    }
}
