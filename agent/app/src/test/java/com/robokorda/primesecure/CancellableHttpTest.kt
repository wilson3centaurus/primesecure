package com.robokorda.primesecure

import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Test
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class CancellableHttpTest {
    @Test fun cancellationInterruptsAStalledResponseBodyWithoutWaitingForReadTimeout() = runBlocking {
        val listening = ServerSocket(0)
        val headersSent = CountDownLatch(1)
        val release = CountDownLatch(1)
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
            val job = launch { call.executeCancellable { it.body!!.string() } }
            assertTrue(withContext(Dispatchers.IO) { headersSent.await(3, TimeUnit.SECONDS) })
            val start = System.nanoTime()
            withTimeout(3000) { job.cancelAndJoin() }
            assertTrue(call.isCanceled())
            assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) < 3000)
        } finally {
            release.countDown();listening.close();server.join(1000)
        }
    }
}
