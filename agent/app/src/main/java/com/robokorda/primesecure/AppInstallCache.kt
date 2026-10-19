package com.robokorda.primesecure

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.io.File
import java.io.IOException

/** Task-owned transport cache only, never proof that an APK is installable. */
internal object AppInstallCache {
    private fun hasHash(hash: String?) = hash?.matches(Regex("[0-9a-fA-F]{64}")) == true

    fun complete(file: File, expectedSize: Long, expectedHash: String?): Boolean =
        hasHash(expectedHash) && expectedSize > 0 && file.isFile && file.length() == expectedSize

    fun bounded(bytes: Long, expectedSize: Long): Boolean =
        bytes in 1..PsApkArchive.MAX_BYTES && (expectedSize < 0 || bytes <= expectedSize)

    /** No new timeout: the caller's existing attempt/worker budgets cover every phase. */
    suspend fun prepare(file: File, expectedSize: Long, expectedHash: String?, maxBytes: Long,
                        download: suspend (resume: Boolean) -> Unit) {
        val coroutine = currentCoroutineContext()
        coroutine.ensureActive()
        if (file.length() > maxBytes || (expectedSize >= 0 && file.length() > expectedSize)) discard(file)
        if (!complete(file, expectedSize, expectedHash)) {
            try {
                download(true)
            } catch (error: ApiException) {
                if (error.code != 416) throw error
                coroutine.ensureActive()
                // A stale/unknown-size range is not evidence of an invalid app. Restart once,
                // scoped here so message/resource/self-update download semantics stay unchanged.
                discard(file)
                try {
                    download(false)
                } catch (retry: ApiException) {
                    if (retry.code != 416) throw retry
                    // Do not chain the 416: the app classifier walks causes before IOExceptions.
                    throw IOException("App transfer range was rejected. Please retry.")
                }
            }
        }
        coroutine.ensureActive()
        require(file.length() <= maxBytes) { "App download exceeds the size limit" }
        if (expectedSize >= 0) require(file.length() == expectedSize) { "App download size does not match catalog" }
        // A full retained cache still has to pass its freshly approved hash on EVERY attempt.
        expectedHash?.let { ApkDownloadHash.verify(file, it) { coroutine.ensureActive() } }
        coroutine.ensureActive()
    }

    fun retain(file: File, expectedSize: Long, expectedHash: String?, taskBound: Boolean,
               prepared: Boolean, error: Throwable?): Boolean {
        if (!taskBound || !hasHash(expectedHash) || !file.isFile || !bounded(file.length(), expectedSize)) return false
        return error is CancellationException || (!prepared && (error is IOException ||
            (error is ApiException && (error.code == 0 || error.code >= 500 || error.code in setOf(401, 408, 425, 429)))))
    }

    private fun discard(file: File) {
        check(!file.exists() || file.delete()) { "Could not save app download. Please retry." }
    }
}
