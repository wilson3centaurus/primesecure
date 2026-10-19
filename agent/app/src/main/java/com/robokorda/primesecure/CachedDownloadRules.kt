package com.robokorda.primesecure

import java.io.File
import java.io.IOException
import java.security.MessageDigest

/** Only reconcile existing school-file tasks. This does not determine APK readiness. */
internal object CachedDownloadRules {
    fun matches(kind: String, itemId: String, action: String, key: String, taskItemId: String, status: String): Boolean =
        kind in setOf("resource", "wallpaper") && itemId.isNotBlank() && action == "download" &&
            key == "download:$itemId" && taskItemId == itemId &&
            status in setOf("queued", "waiting", "downloading", "syncing")

    fun ready(file: File, size: Long, sha256: String?, checkCancelled: () -> Unit = {}): Boolean {
        if (!file.isFile || file.name.endsWith(".part", true) ||
            file.extension.lowercase() in setOf("apk", "psapk") || size < 0 || file.length() != size) return false
        val expected = sha256?.takeIf { it.isNotBlank() } ?: return true
        if (!expected.matches(Regex("[0-9a-fA-F]{64}"))) return false
        return try {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buffer = ByteArray(65536)
                while (true) {
                    checkCancelled()
                    val count = input.read(buffer)
                    if (count < 0) break
                    digest.update(buffer, 0, count)
                }
            }
            file.length() == size && digest.digest().joinToString("") { "%02x".format(it) }.equals(expected, true)
        } catch (_: IOException) { false }
    }
}
