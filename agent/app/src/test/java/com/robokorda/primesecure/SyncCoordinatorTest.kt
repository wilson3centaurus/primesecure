package com.robokorda.primesecure

import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class SyncCoordinatorTest {
    @Test fun burstsProduceOneFollowUpWithoutCancellingCurrentPolicy()= runBlocking {
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Default)
        try {
            val started=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>();val done=CompletableDeferred<Unit>()
            var calls=0
            val sync=SyncCoordinator(scope,{
                calls++
                if(calls==1) { started.complete(Unit);release.await() } else done.complete(Unit)
            },{ throw AssertionError(it) })
            sync.request();withTimeout(5000) { started.await() }
            repeat(100) { sync.request() }
            assertEquals(1,calls)
            release.complete(Unit);withTimeout(5000) { done.await() }
            assertEquals(2,calls)
        } finally { scope.cancel() }
    }
    @Test fun failureDoesNotStopLaterSyncRequests()=runBlocking {
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Default)
        try {
            val failed=CompletableDeferred<Unit>();val done=CompletableDeferred<Unit>();var calls=0
            val sync=SyncCoordinator(scope,{
                if(++calls==1)throw java.io.IOException("offline") else done.complete(Unit)
            },{ failed.complete(Unit) })
            sync.request();withTimeout(5000) { failed.await() };sync.request()
            withTimeout(5000) { done.await() };assertEquals(2,calls)
        } finally { scope.cancel() }
    }
}
