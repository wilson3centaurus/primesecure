package com.robokorda.primesecure

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Test
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class StudentUiUpdateRulesTest {
    @Test fun firstCatalogFetchCanCheckWithoutWaitingForContent() {
        assertTrue(StudentUiUpdateRules.due(0, 1))
    }

    @Test fun boundedBatchesDoNotRepeatRequestsWithinFifteenMinutes() {
        assertFalse(StudentUiUpdateRules.due(1_000, 1_001))
        assertFalse(StudentUiUpdateRules.due(1_000, 900_999))
        assertTrue(StudentUiUpdateRules.due(1_000, 901_000))
    }

    @Test fun clockCorrectionDoesNotSuppressUpdatesIndefinitely() {
        assertTrue(StudentUiUpdateRules.due(1_000, 999))
    }

    @Test fun uiDeadlineCancelsStalledHttpWithoutWaitingForReadTimeout() = runBlocking {
        val listening = ServerSocket(0)
        val release = CountDownLatch(1)
        val headersSent = CountDownLatch(1)
        val server = thread(isDaemon = true) {
            runCatching { listening.accept().use { socket ->
                val reader = socket.getInputStream().bufferedReader()
                while (!reader.readLine().isNullOrEmpty()) { }
                socket.getOutputStream().apply {
                    write("HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\nx".toByteArray())
                    flush()
                }
                headersSent.countDown()
                release.await(10, TimeUnit.SECONDS)
            } }
        }
        try {
            val client = OkHttpClient.Builder().readTimeout(30, TimeUnit.SECONDS).build()
            val call = client.newCall(Request.Builder().url("http://127.0.0.1:${listening.localPort}/").build())
            val start = System.nanoTime()
            assertNull(withTimeoutOrNull(StudentUiUpdateRules.CHECK_MILLIS) {
                call.executeCancellable { it.body!!.string() }
            })
            assertEquals(0L, headersSent.count)
            assertTrue(call.isCanceled())
            assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) < 8_000)
        } finally {
            release.countDown(); listening.close(); server.join(1_000)
        }
    }
}
