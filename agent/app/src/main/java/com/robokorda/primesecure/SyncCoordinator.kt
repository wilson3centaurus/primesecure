package com.robokorda.primesecure

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

/** One active sync plus one coalesced follow-up, without cancelling an in-flight policy. */
internal class SyncCoordinator(scope:CoroutineScope,action:suspend ()->Unit,onFailure:(Exception)->Unit) {
    private val requests=Channel<Unit>(Channel.CONFLATED)
    private val worker=scope.launch {
        for(request in requests) {
            try { action() } catch(e:Exception) {
                if(e is CancellationException)throw e
                onFailure(e)
            }
        }
    }.also { job -> job.invokeOnCompletion { requests.close() } }
    fun request() { requests.trySend(Unit) }
}
