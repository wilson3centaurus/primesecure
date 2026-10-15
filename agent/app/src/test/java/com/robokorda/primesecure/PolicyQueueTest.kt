package com.robokorda.primesecure

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class PolicyQueueTest {
    @Test fun bootReadsLatestCacheAfterAnInFlightCheckInFinishes() = runBlocking {
        val queue = PolicyQueue()
        var saved = "old strict policy"
        val started = CompletableDeferred<Unit>()
        val finishCheckIn = CompletableDeferred<Unit>()
        val fresh = async(start = CoroutineStart.UNDISPATCHED) {
            queue.apply({ "new maintenance policy" }) {
                started.complete(Unit)
                finishCheckIn.await()
                saved = it
            }
        }
        started.await()
        val boot = async(start = CoroutineStart.UNDISPATCHED) { queue.apply({ saved }) { it } }
        assertFalse(boot.isCompleted)
        finishCheckIn.complete(Unit)
        fresh.await()
        assertEquals("new maintenance policy", boot.await())
    }

    @Test fun failedPolicyDoesNotPreventTheNextRecoveryPolicy() = runBlocking {
        val queue = PolicyQueue()
        try {
            queue.apply({ "bad policy" }) { error(it) }
            fail("Expected policy failure")
        } catch (_: IllegalStateException) { }
        assertEquals("recovered", queue.apply({ "recovered" }) { it })
    }
}
