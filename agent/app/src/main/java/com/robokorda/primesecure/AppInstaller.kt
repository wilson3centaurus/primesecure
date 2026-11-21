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
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.UUID
import kotlin.coroutines.resume

/** Silent install / uninstall, which PackageInstaller allows the Device Owner without prompting. */
class AppInstaller(private val context: Context, private val store: AgentStore) {

    private val pm = context.packageManager
    private val dpm = AdminReceiver.dpm(context)
    private val admin = AdminReceiver.component(context)

    /** Installs an AVB-protected factory payload without downloading a duplicate. */
    suspend fun installFactory(item: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        require(item.optString("kind") == "app" && (item.optBoolean("factory_autoinstall") || item.optBoolean("preinstall"))) {
            "Factory app is not approved for automatic installation"
        }
        val archive = FactoryPreload.file(item) ?: throw IllegalArgumentException("Factory app is missing")
        val expectedSize = item.optLong("size", -1)
        require(expectedSize >= 0 && archive.length() == expectedSize) { "Factory app size mismatch" }
        item.stringOrNull("sha256")?.let { expected ->
            val digest = java.security.MessageDigest.getInstance("SHA-256")
            archive.inputStream().use { input ->
                val buffer = ByteArray(65536)
                while (true) { currentCoroutineContext().ensureActive(); val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
            }
            require(digest.digest().joinToString("") { "%02x".format(it) }.equals(expected, true)) { "Factory app hash mismatch" }
        }
        val extracted = File(context.cacheDir, "factory-install-${UUID.randomUUID()}")
        try {
            val isSet = PsApkArchive.isSet(item.optString("factory_path"))
            val coroutine = currentCoroutineContext()
            val members = if (isSet) PsApkArchive.extract(archive, extracted) { coroutine.ensureActive() }
                .map { ApkSetInspector.inspect(it, Build.VERSION.SDK_INT) }
            else listOf(ApkSetInspector.inspect(archive, Build.VERSION.SDK_INT))
            val plan = if (isSet) ApkSetPlan.create(members, Build.VERSION.SDK_INT, Build.SUPPORTED_ABIS.toList())
                else ApkSetPlan.single(members.single(), Build.VERSION.SDK_INT, Build.SUPPORTED_ABIS.toList())
            val base = members.single { it.splitName == null }
            require(base.packageName == item.getString("package_name")) { "Factory app package mismatch" }
            require(base.packageName != context.packageName) { "PrimeSecure updates use the agent release channel" }
            installFiles(plan, base.packageName)
            JSONObject().put("package", base.packageName).put("version", base.versionName ?: JSONObject.NULL)
        } finally { extracted.deleteRecursively() }
    }

    suspend fun install(commandId: String, payload: JSONObject, taskId: String? = null): JSONObject = withContext(Dispatchers.IO) {
        val path = payload.stringOrNull("storage_path") ?: throw IllegalArgumentException("no storage_path")
        val bucket = payload.optString("bucket", "apks")
        require(bucket in setOf("apks", "primesecure-hub")) { "Unsupported app source" }
        // The fresh catalog, rather than payload MIME or the cache filename, authorizes
        // the hub object and supplies its hash. Remote commands explicitly name .psapk.
        suspend fun approvedItem(): JSONObject? {
            if (bucket != "primesecure-hub") return null
            val catalog = SupabaseApi(store).deviceHub()
            require(catalog.optString("status", store.lastStatus.orEmpty()) == "active") { "App installs require an active school device" }
            val items = catalog.getJSONArray("items")
            return (0 until items.length()).map { items.getJSONObject(it) }.find {
                it.optString("id") == payload.optString("hub_item_id") && it.optString("kind") == "app" &&
                    it.optString("storage_path") == path && it.optString("package_name") == payload.optString("package")
            } ?: throw IllegalArgumentException("App is no longer approved for this device")
        }
        val approved = approvedItem()
        val isSet = PsApkArchive.isSet(approved?.getString("storage_path") ?: path)
        if (isSet && approved != null) require(approved.optString("mime_type") == PsApkArchive.MIME) { "Invalid catalog APK set MIME type" }
        // Legacy staff commands in the separate `apks` bucket predate catalog hashes.
        // Keep that signed single-APK workflow working; hub items and ALL APK sets
        // still require a hash from the freshly authorized source.
        val suppliedHash = if (approved != null) approved.stringOrNull("sha256") else payload.stringOrNull("sha256")
        val expectedHash = ApkDownloadHash.expectedForSource(suppliedHash, legacySingleApk = bucket == "apks" && !isSet)
        val expectedSize = approved?.optLong("size", -1) ?: -1L
        if (isSet) require(expectedSize <= PsApkArchive.MAX_BYTES) { "APK set download exceeds the size limit" }
        val cacheKey = java.security.MessageDigest.getInstance("SHA-256")
            .digest("$commandId|$bucket|$path|$expectedHash".toByteArray()).joinToString("") { "%02x".format(it) }
        val apk = File(context.cacheDir, "install-$cacheKey.${if (isSet) "psapk" else "apk"}")
        val extracted = File(context.cacheDir, "install-set-${UUID.randomUUID()}")
        var prepared = false
        var retainCache = false
        try {
            val tasks = HubTasks(context)
            val maxBytes = if (isSet) PsApkArchive.MAX_BYTES else Long.MAX_VALUE
            AppInstallCache.prepare(apk, expectedSize, expectedHash, maxBytes) { resume ->
                SupabaseApi(store).download("/storage/v1/object/$bucket/$path", apk, resume = resume,
                    maxBytes = maxBytes) { bytes, total, speed ->
                    if (taskId != null) tasks.update(taskId, "downloading", bytes, total, speed)
                }
            }
            prepared = true
            val coroutine = currentCoroutineContext()
            coroutine.ensureActive()
            val (plan, packageName, versionName) = if (isSet) {
                val files = PsApkArchive.extract(apk, extracted, checkCancelled = { coroutine.ensureActive() })
                val members = files.map {
                    coroutine.ensureActive()
                    ApkSetInspector.inspect(it, Build.VERSION.SDK_INT).also { coroutine.ensureActive() }
                }
                val sessionFiles = ApkSetPlan.create(members, Build.VERSION.SDK_INT, Build.SUPPORTED_ABIS.toList())
                val base = members.single { it.splitName == null }
                Triple(sessionFiles, base.packageName, base.versionName)
            } else {
                // Old catalog rows can still contain a split-dependent base APK. Fail
                // before opening a session, with the same checks as a complete set.
                coroutine.ensureActive()
                val member = ApkSetInspector.inspect(apk, Build.VERSION.SDK_INT).also { coroutine.ensureActive() }
                Triple(ApkSetPlan.single(member, Build.VERSION.SDK_INT, Build.SUPPORTED_ABIS.toList()),
                    member.packageName, member.versionName)
            }
            payload.stringOrNull("package")?.let { require(packageName == it) { "APK package does not match catalog" } }
            if (packageName == context.packageName) throw IllegalArgumentException("use the agent update instead")
            if (approved != null) {
                val fresh = approvedItem()!!
                require(fresh.stringOrNull("sha256") == expectedHash && (!isSet || fresh.optString("mime_type") == PsApkArchive.MIME)) {
                    "App catalog changed during download. Please retry."
                }
            }
            if (taskId != null) tasks.update(taskId, "installing")
            coroutine.ensureActive()
            installFiles(plan, packageName)
            JSONObject()
                .put("package", packageName)
                .put("version", versionName ?: JSONObject.NULL)
        } catch (e: Exception) {
            retainCache = AppInstallCache.retain(apk, expectedSize, expectedHash, taskId != null, prepared, e)
            throw e
        } finally {
            extracted.deleteRecursively()
            // A cancelled task can reuse bounded bytes, but never skip fresh hash/manifest/
            // signature checks. Success, corruption and unowned/legacy cache are removed.
            if (!retainCache) apk.delete()
        }
    }

    fun archiveInfo(apk: File): android.content.pm.PackageInfo {
        @Suppress("DEPRECATION")
        return pm.getPackageArchiveInfo(apk.path, 0) ?: throw IllegalArgumentException("not a valid APK")
    }

    /** Installs (or updates) [apk] silently; suspends until PackageInstaller reports back. */
    suspend fun installFile(apk: File, packageName: String) = installFiles(listOf(SessionApk("base.apk", apk)), packageName)

    private suspend fun installFiles(files: List<SessionApk>, packageName: String) = installation.withLock {
        currentCoroutineContext().ensureActive()
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(packageName)
        params.setSize(files.sumOf { it.file.length() })
        val installer = pm.packageInstaller
        val sessionId = installer.createSession(params)
        try {
            withUnknownSourcesAllowed {
                installer.openSession(sessionId).use { session ->
                    for (apk in files) {
                        currentCoroutineContext().ensureActive()
                        apk.file.inputStream().use { input ->
                            session.openWrite(apk.name, 0, apk.file.length()).use { output ->
                                val buffer = ByteArray(64 * 1024)
                                while (true) {
                                    currentCoroutineContext().ensureActive()
                                    val count = input.read(buffer)
                                    if (count < 0) break
                                    output.write(buffer, 0, count)
                                }
                                session.fsync(output)
                            }
                        }
                    }
                    awaitResult("install-$sessionId") { sender -> session.commit(sender) }
                }
            }
        } catch (e: Throwable) {
            runCatching { installer.abandonSession(sessionId) }
            throw e
        }
    }
    companion object { private val installation = Mutex() }

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
        var failure: Throwable? = null
        try {
            active.forEach { dpm.clearUserRestriction(admin, it) }
            return block()
        } catch (e: Throwable) {
            failure = e
            throw e
        } finally {
            var restoreFailure: Throwable? = null
            active.forEach { key ->
                try { dpm.addUserRestriction(admin, key) }
                catch (e: Throwable) { if (restoreFailure == null) restoreFailure = e else restoreFailure!!.addSuppressed(e) }
            }
            restoreFailure?.let { if (failure != null) failure.addSuppressed(it) else throw it }
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
