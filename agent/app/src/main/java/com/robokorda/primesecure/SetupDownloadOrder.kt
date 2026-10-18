package com.robokorda.primesecure

/** Pure ordering used by the transfer worker, not just by the task-list UI. */
internal data class SetupDownload(val id: String, val kind: String, val size: Long,
    val title: String = "", val form: String = "", val subject: String = "", val category: String = "",
    val mime: String = "")

internal object SetupDownloadOrder {
    fun priority(item: SetupDownload): Int = when (item.kind) {
        "wallpaper" -> 0
        "app" -> 1
        else -> {
            val path = listOf(item.form, item.subject, item.category, item.title)
                .joinToString(" ").lowercase(java.util.Locale.ROOT)
            when {
                Regex("\\brobotics\\b").containsMatchIn(path) -> 2
                Regex("explore\\s*(?:&|and)\\s*grow").containsMatchIn(path) ||
                    item.mime.startsWith("image/") || Regex("\\bimages?\\b").containsMatchIn(path) -> 3
                else -> 4
            }
        }
    }
    fun ordered(items: List<SetupDownload>) = items.sortedWith(compareBy<SetupDownload> { priority(it) }
        .thenBy { if (it.size < 0) Long.MAX_VALUE else it.size }.thenBy { it.id })

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
