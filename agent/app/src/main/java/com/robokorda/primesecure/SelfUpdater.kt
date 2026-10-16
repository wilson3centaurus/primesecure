package com.robokorda.primesecure

import android.content.Context
import android.content.pm.PackageInfo
import android.os.Build
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * Installs a newer agent offered by check-in ('agent_update'). The APK must be
 * our package, signed with the same key (PackageInstaller enforces that), and
 * carry exactly the advertised version code and checksum. Android restarts the
 * app after the update; BootReceiver's MY_PACKAGE_REPLACED re-arms everything.
 */
object SelfUpdater {

    suspend fun maybeUpdate(context: Context, store: AgentStore, offer: JSONObject?) {
        offer ?: return
        val code = offer.optInt("version_code", 0)
        if (code <= BuildConfig.VERSION_CODE) return
        if (!UpdateRetryRules.due(code, store.updateAttemptCode, store.updateAttemptAt, System.currentTimeMillis())) return
        store.updateAttemptCode = code
        store.updateAttemptAt = System.currentTimeMillis()

        val path = offer.stringOrNull("storage_path") ?: return
        val apk = File(context.cacheDir, "agent-$code.apk")
        try {
            SupabaseApi(store).download("/storage/v1/object/agent/$path", apk)
            offer.stringOrNull("sha256")?.let { expected ->
                if (sha256(apk) != expected.lowercase()) error("checksum mismatch")
            }
            val installer = AppInstaller(context, store)
            val info = installer.archiveInfo(apk)
            if (info.packageName != context.packageName) error("APK is ${info.packageName}, not the agent")
            if (versionCode(info) != code.toLong()) error("APK is version ${versionCode(info)}, expected $code")
            store.updateError = null
            installer.installFile(apk, info.packageName) // the process is replaced shortly after success
        } catch (e: Exception) {
            if(e is kotlinx.coroutines.CancellationException)throw e
            DeviceLog.event(context,"error","update","agent_update_failed",e)
            store.updateError = "update to $code failed: ${e.message}"
            CheckInWorker.retryUpdate(context)
        } finally {
            apk.delete()
        }
    }

    private fun versionCode(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode
        else @Suppress("DEPRECATION") info.versionCode.toLong()

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                digest.update(buffer, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
