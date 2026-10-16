package com.robokorda.primesecure

object UpdateRetryRules {
    const val DELAY_MS = 5 * 60_000L
    fun due(code: Int, attemptedCode: Int, attemptedAt: Long, now: Long): Boolean =
        code != attemptedCode || now < attemptedAt || now - attemptedAt >= DELAY_MS
}
