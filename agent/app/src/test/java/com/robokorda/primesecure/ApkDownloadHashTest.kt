package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.security.MessageDigest

class ApkDownloadHashTest {
    @org.junit.Test fun onlyLegacySingleApksMayOmitDownloadHash() {
        org.junit.Assert.assertNull(ApkDownloadHash.expectedForSource(null, true))
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) { ApkDownloadHash.expectedForSource(null, false) }
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) { ApkDownloadHash.expectedForSource("bad", true) }
    }
    @get:Rule val temp = TemporaryFolder()
    private val bytes = ByteArray(150_000) { (it * 31).toByte() }
    private val expected = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    @Test fun verifiesBothStandaloneAndContainerBytesIncludingUppercaseHash() {
        for (name in listOf("single.apk", "set.psapk")) {
            val file = temp.newFile(name).apply { writeBytes(bytes) }
            ApkDownloadHash.verify(file, expected.uppercase())
            file.appendBytes(byteArrayOf(1))
            assertThrows(IllegalStateException::class.java) { ApkDownloadHash.verify(file, expected) }
        }
    }
    @Test fun missingAndMalformedHashesFailWithReuploadGuidance() {
        for (hash in listOf(null, "", "abcd", "g".repeat(64))) {
            val failure = assertThrows(IllegalArgumentException::class.java) { ApkDownloadHash.expected(hash) }
            assertTrue(failure.message.orEmpty().contains("re-upload"))
        }
    }
}
