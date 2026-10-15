package com.robokorda.primesecure

internal data class ForegroundEvent(val at: Long, val packageName: String, val resumed: Boolean)

/** Foreground intervals only: never records keys, URLs, screen pixels or document/message contents. */
internal object UsageTimeline {
    fun totals(start: Long, end: Long, events: List<ForegroundEvent>): Map<String, Long> {
        require(end >= start)
        val result = mutableMapOf<String, Long>()
        var active: String? = null
        var since = start
        fun close(at: Long) {
            active?.let { pkg -> result[pkg] = (result[pkg] ?: 0L) + (at - since).coerceAtLeast(0) }
        }
        for (event in events.sortedBy { it.at }) {
            if (event.at !in start..end) continue
            // Empty package + pause represents screen off/device shutdown.
            if (event.packageName.isBlank()) {
                if (!event.resumed) {
                    close(event.at)
                    active = null
                }
                continue
            }
            if (event.resumed) {
                if (active == event.packageName) continue
                close(event.at)
                active = event.packageName
                since = event.at
            } else if (active == event.packageName) {
                close(event.at)
                active = null
            }
        }
        close(end)
        return result.filterValues { it > 0 }
    }

    // A killed/suspended agent must not pretend to have observed the intervening hours.
    fun observedDelta(elapsed: Long, previous: Long): Long =
        (elapsed - previous).takeIf { previous > 0 && it in 1..90_000L } ?: 0
}
