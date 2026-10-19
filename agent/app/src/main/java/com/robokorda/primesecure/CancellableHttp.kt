package com.robokorda.primesecure

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Response
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Cancellation closes the socket even while execute()/body.read() is blocking.
 * Checking ensureActive only between reads cannot interrupt a stalled read. */
internal suspend fun <T> Call.executeCancellable(read: (Response) -> T): T = withContext(Dispatchers.IO) {
    suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation { cancel() }
        try {
            val value = execute().use(read)
            continuation.resume(value)
        } catch (error: Exception) {
            if (continuation.isActive) continuation.resumeWithException(error)
        }
    }
}
