package com.robokorda.primesecure

import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException
import java.security.MessageDigest

class AppInstallCacheTest {
    @get:Rule val temporary = TemporaryFolder()
    private val data = "complete app bytes".toByteArray()
    private val hash = MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }
    private val size get() = data.size.toLong()
    private fun file(bytes: ByteArray = data) = temporary.newFile().apply { writeBytes(bytes) }

    @Test fun exactSizeRetainedFileSkipsHttpButStillVerifiesHash() = runBlocking {
        val target = file()
        AppInstallCache.prepare(target, size, hash, PsApkArchive.MAX_BYTES) { fail("No Range request for a full cache") }
        assertArrayEquals(data, target.readBytes())
        target.writeBytes(ByteArray(data.size))
        var accepted = false
        try {
            AppInstallCache.prepare(target, size, hash, PsApkArchive.MAX_BYTES) { fail("Full cache is verified locally") }
            accepted = true
        } catch (_: IllegalStateException) { }
        assertFalse("Equal size alone never authorizes an installation", accepted)
    }

    @Test fun missingAndPartialFilesStillDownloadAndVerify() = runBlocking {
        for (target in listOf(File(temporary.root, "missing"), file(data.copyOf(1)))) {
            val resumes = mutableListOf<Boolean>()
            AppInstallCache.prepare(target, size, hash, PsApkArchive.MAX_BYTES) { resume -> resumes += resume; target.writeBytes(data) }
            assertEquals(listOf(true), resumes)
        }
    }

    @Test fun staleRange416RestartsExactlyOnceWithoutRange() = runBlocking {
        val target = file(data.copyOf(1))
        val resumes = mutableListOf<Boolean>()
        AppInstallCache.prepare(target, size, hash, PsApkArchive.MAX_BYTES) { resume ->
            resumes += resume
            if (resume) throw ApiException(416, "range")
            assertFalse("Stale transport cache is discarded before clean download", target.exists())
            target.writeBytes(data)
        }
        assertEquals(listOf(true, false), resumes)
    }

    @Test fun repeated416IsRetryableWithoutLoopingOrPermanentBadAppState() = runBlocking {
        val target = file(data.copyOf(1)); val resumes = mutableListOf<Boolean>()
        try {
            AppInstallCache.prepare(target, size, hash, PsApkArchive.MAX_BYTES) { resume ->
                resumes += resume; throw ApiException(416, "range")
            }
            fail("Two failed requests must not reach validation/install")
        } catch (error: IOException) {
            assertFalse(HubInstallRetryRules.terminal(error))
        }
        assertEquals(listOf(true, false), resumes)
    }

    @Test fun otherHttpErrorsNeverTriggerCleanRestart() = runBlocking {
        for (code in listOf(401, 403, 404, 429, 503)) {
            val target = file(data.copyOf(1)); val resumes = mutableListOf<Boolean>()
            try {
                AppInstallCache.prepare(target, size, hash, PsApkArchive.MAX_BYTES) { resume ->
                    resumes += resume; throw ApiException(code, "fixture")
                }
                fail("Error must propagate")
            } catch (error: ApiException) { assertEquals(code, error.code) }
            assertEquals(listOf(true), resumes)
        }
    }

    @Test fun cleanRestartMustStillPassHashAndCatalogSize() = runBlocking {
        for (bad in listOf(ByteArray(data.size), data.copyOf(1))) {
            val target = file(data.copyOf(1))
            var accepted = false
            try {
                AppInstallCache.prepare(target, size, hash, PsApkArchive.MAX_BYTES) { resume ->
                    if (resume) throw ApiException(416, "range")
                    target.writeBytes(bad)
                }
                accepted = true
            } catch (_: IllegalArgumentException) { } catch (_: IllegalStateException) { }
            assertFalse(accepted)
        }
    }

    @Test fun oversizeStaleCacheIsRemovedBeforeRequest() = runBlocking {
        val target = file(data + byteArrayOf(1))
        AppInstallCache.prepare(target, size, hash, PsApkArchive.MAX_BYTES) {
            assertFalse(target.exists()); target.writeBytes(data)
        }
    }

    @Test fun unknownSizeIsNeverAssumedCompleteAndLegacyWithoutHashIsNeverRetained() = runBlocking {
        val target = file(); var requested = false
        AppInstallCache.prepare(target, -1, hash, PsApkArchive.MAX_BYTES) { requested = true; target.writeBytes(data) }
        assertTrue(requested)
        requested = false
        AppInstallCache.prepare(target, size, null, PsApkArchive.MAX_BYTES) { requested = true; target.writeBytes(data) }
        assertTrue("Legacy hashless sources must use a fresh network response", requested)
        assertFalse(AppInstallCache.complete(target, size, null))
        assertFalse(AppInstallCache.retain(target, size, null, true, false, CancellationException()))
    }

    @Test fun cancellationAtLastDownloadByteKeepsFullCacheAndNextAttemptDoesNotRequestRange() = runBlocking {
        val target = file(data.copyOf(1))
        val error = CancellationException("last-byte race")
        try {
            AppInstallCache.prepare(target, size, hash, PsApkArchive.MAX_BYTES) { target.writeBytes(data); throw error }
            fail("Cancellation must propagate")
        } catch (cancelled: CancellationException) { assertSame(error, cancelled) }
        assertTrue(AppInstallCache.retain(target, size, hash, true, false, error))
        AppInstallCache.prepare(target, size, hash, PsApkArchive.MAX_BYTES) { fail("Full cancelled download must skip HTTP") }
    }

    @Test fun validationCancellationKeepsBoundedTaskCacheButSuccessOrDefinitiveFailureDoesNot() {
        val target = file()
        assertTrue(AppInstallCache.retain(target, size, hash, true, true, CancellationException()))
        assertFalse(AppInstallCache.retain(target, size, hash, false, true, CancellationException()))
        for (error in listOf(null, IllegalStateException("damaged hash"), IllegalArgumentException("invalid signer"),
                             ApiException(403, "withdrawn"), IOException("failed after validation")))
            assertFalse(AppInstallCache.retain(target, size, hash, true, true, error))
    }

    @Test fun onlyBoundedTaskOwnedTransportFailuresAreRetained() {
        val target = file(data.copyOf(1))
        for (error in listOf(IOException("network"), ApiException(503, "server"), ApiException(429, "limit")))
            assertTrue(AppInstallCache.retain(target, size, hash, true, false, error))
        assertFalse(AppInstallCache.retain(target, size, hash, false, false, IOException()))
        assertFalse(AppInstallCache.retain(target, size, "malformed", true, false, IOException()))
        assertFalse(AppInstallCache.retain(file(ByteArray(0)), size, hash, true, false, CancellationException()))
        assertFalse(AppInstallCache.retain(file(data + byteArrayOf(1)), size, hash, true, false, CancellationException()))
        assertFalse(AppInstallCache.bounded(0, -1))
        assertTrue(AppInstallCache.bounded(500_000_000, -1))
        assertFalse(AppInstallCache.bounded(500_000_001, -1))
        assertFalse(AppInstallCache.bounded(2, 1))
    }

    @Test fun cancellationDuringFreshRetryDoesNotStartThirdRequest() = runBlocking {
        val target = file(data.copyOf(1)); var requests = 0
        try {
            AppInstallCache.prepare(target, size, hash, PsApkArchive.MAX_BYTES) { resume ->
                requests++
                if (resume) throw ApiException(416, "range")
                throw CancellationException("manual sync")
            }
            fail("Cancellation must propagate")
        } catch (_: CancellationException) { }
        assertEquals(2, requests)
    }

    @Test fun cancelledBudgetNeverStartsHttpOrAcceptsCachedBytes() = runBlocking {
        val target = file(); var requested = false; var accepted = false
        val job = launch(start = CoroutineStart.UNDISPATCHED) {
            currentCoroutineContext().cancel()
            AppInstallCache.prepare(target, size, hash, PsApkArchive.MAX_BYTES) { requested = true }
            accepted = true
        }
        job.cancelAndJoin()
        assertFalse(requested); assertFalse(accepted)
    }
}
