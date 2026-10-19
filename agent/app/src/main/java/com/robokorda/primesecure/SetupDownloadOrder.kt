package com.robokorda.primesecure

/** Pure ordering used by the transfer worker, not just by the task-list UI. */
internal data class SetupDownload(val id: String, val kind: String, val size: Long,
    val title: String = "", val form: String = "", val subject: String = "", val category: String = "",
    val mime: String = "", val storagePath: String = "", val sha256: String = "") {
    // A corrected/replaced catalog object must not inherit an older object's failed attempt.
    val workKey: String get() = listOf(id, storagePath, size.toString(), sha256).joinToString("|")
}

internal data class SetupPassResult(val successful: Boolean, val deferred: Boolean, val attempted: Int)

internal enum class HubSyncQueuePolicy { KEEP, APPEND, REPLACE }

/** Retry transport problems, but require an explicit Retry or changed catalog object
 * before trying a known invalid APK again. This state never uninstalls existing apps. */
internal object HubInstallRetryRules {
    fun identity(path: String, sha256: String) = "$path|${sha256.lowercase(java.util.Locale.ROOT)}"
    fun shouldAutoEnqueue(identity: String, failedIdentity: String?, pending: Boolean) =
        !pending && identity != failedIdentity

    fun terminal(error: Throwable): Boolean {
        val causes = generateSequence(error) { it.cause }.toList()
        causes.filterIsInstance<kotlinx.coroutines.CancellationException>().firstOrNull()?.let { throw it }
        causes.filterIsInstance<ApiException>().firstOrNull()?.let {
            return it.code in 400..499 && it.code !in setOf(401, 408, 425, 429)
        }
        if (causes.any { it is java.util.zip.ZipException || it is java.security.GeneralSecurityException ||
                it is java.nio.BufferUnderflowException || it.javaClass.simpleName in setOf("ApkFormatException", "XmlParserException", "JSONException") }) return true
        if (causes.any { it is java.io.IOException }) return false
        val message = causes.mapNotNull { it.message }.joinToString(" ").lowercase(java.util.Locale.ROOT)
        if (listOf("timed out", "timeout", "catalog changed", "download is damaged", "storage is nearly full", "not enough space", "no space left", "insufficient_storage",
                "could not save", "install_failed_internal_error", "install_failed_aborted").any { it in message }) return false
        return causes.any { it is IllegalArgumentException || it is IllegalStateException }
    }
}

internal object HubSyncScheduling {
    const val MAX_ITEMS = 8
    const val PASS_MILLIS = 3 * 60_000L
    const val ATTEMPT_MILLIS = 90_000L
    const val WORKER_MILLIS = 4 * 60_000L
    const val FAILURE_DELAY_MILLIS = 30_000L
    fun policy(followUp: Boolean, force: Boolean) = when {
        force -> HubSyncQueuePolicy.REPLACE
        followUp -> HubSyncQueuePolicy.APPEND
        else -> HubSyncQueuePolicy.KEEP
    }
}

internal object SetupDownloadOrder {
    fun priority(item: SetupDownload): Int = when (item.kind) {
        "wallpaper" -> 0
        "app" -> 2
        else -> if (isImage(item)) 1 else 3
    }

    private fun isImage(item: SetupDownload): Boolean = item.mime.startsWith("image/", ignoreCase = true) ||
        (item.mime.isBlank() && (Regex("\\.(?:png|jpe?g|webp|gif|bmp|avif|heic)$", RegexOption.IGNORE_CASE)
            .containsMatchIn(item.storagePath.ifBlank { item.title }) ||
            Regex("\\bimages?\\b", RegexOption.IGNORE_CASE).containsMatchIn(item.category)))

    private fun notePriority(item: SetupDownload): Int {
        if (item.kind != "resource") return 0
        val path = listOf(item.form, item.subject, item.category, item.title)
            .joinToString(" ").lowercase(java.util.Locale.ROOT)
        return when {
            Regex("\\brobotics\\b").containsMatchIn(path) -> 0
            Regex("explore\\s*(?:&|and)\\s*grow").containsMatchIn(path) -> 1
            else -> 2
        }
    }
    fun ordered(items: List<SetupDownload>) = items.sortedWith(compareBy<SetupDownload> { priority(it) }
        .thenBy { notePriority(it) }
        .thenBy { if (it.size < 0) Long.MAX_VALUE else it.size }.thenBy { it.id })

    /** Reload before choosing each item: a newly arrived wallpaper outranks old lower streams.
     * Failed objects carry across bounded batches, so an early broken stream cannot starve
     * later ones. Cancellation propagates and does not mark an interrupted object attempted. */
    suspend fun runBoundedPass(
        load: suspend () -> List<SetupDownload>, now: () -> Long,
        deferredFailures: Set<String> = emptySet(), maxItems: Int = HubSyncScheduling.MAX_ITEMS,
        maxMillis: Long = HubSyncScheduling.PASS_MILLIS,
        record: (SetupDownload, Boolean) -> Unit = { _, _ -> },
        attempt: suspend (SetupDownload, Long) -> Boolean,
    ): SetupPassResult {
        require(maxItems > 0 && maxMillis > 0)
        val started = now()
        val seen = deferredFailures.toMutableSet()
        var successful = true
        var attempted = 0
        while (true) {
            val next = ordered(load()).firstOrNull { it.workKey !in seen }
                ?: return SetupPassResult(successful, false, attempted)
            val remaining = maxMillis - (now() - started).coerceAtLeast(0)
            if (attempted >= maxItems || remaining <= 0) return SetupPassResult(successful, true, attempted)
            val result = attempt(next, minOf(remaining, HubSyncScheduling.ATTEMPT_MILLIS))
            seen += next.workKey
            attempted++
            if (!result) successful = false
            record(next, result)
        }
    }

    /** Each failure is deferred to the next worker run, never retried ahead of later streams. */
    suspend fun runPass(items: List<SetupDownload>, attempt: suspend (SetupDownload) -> Boolean): Boolean {
        var successful = true
        for (item in ordered(items)) if (!attempt(item)) successful = false
        return successful
    }
}

internal data class SetupClockReading(val elapsed: Long, val uptime: Long, val wall: Long, val boot: Int,
    val estimated: Boolean = false)

internal object SetupProgressMath {
    fun tick(previous: SetupClockReading, uptime: Long, wall: Long, boot: Int): SetupClockReading {
        val monotonic = boot == previous.boot && uptime >= previous.uptime
        val delta = if (monotonic) uptime - previous.uptime else (wall - previous.wall).coerceAtLeast(0)
        return SetupClockReading(previous.elapsed + delta, uptime, wall, boot,
            previous.estimated || !monotonic || wall < previous.wall)
    }
    fun complete(known: Boolean, total: Int, completed: Int) = known && total == completed
    fun received(size: Long, bytes: Long, complete: Boolean): Long =
        if (size < 0) 0 else if (complete) size else bytes.coerceIn(0, size)
}
