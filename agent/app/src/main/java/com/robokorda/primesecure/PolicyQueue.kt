package com.robokorda.primesecure

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Read saved policy only after prior application finishes, so boot cannot replay a stale snapshot. */
internal class PolicyQueue {
    private val mutex = Mutex()
    suspend fun <T, R> apply(read: () -> T, action: suspend (T) -> R): R =
        mutex.withLock { action(read()) }
}
