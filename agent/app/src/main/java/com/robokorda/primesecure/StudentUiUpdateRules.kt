package com.robokorda.primesecure

/** Independent of catalogue completion; bounded so presentation cannot stall school files. */
internal object StudentUiUpdateRules {
    const val CHECK_MILLIS = 5_000L
    const val INTERVAL_MILLIS = 15 * 60_000L

    fun due(lastAttempt: Long, now: Long): Boolean =
        lastAttempt <= 0 || now < lastAttempt || now - lastAttempt >= INTERVAL_MILLIS
}
