package com.robokorda.primesecure

import kotlinx.coroutines.CancellationException
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.security.MessageDigest

class CachedDownloadRulesTest {
    @get:Rule val temporary = TemporaryFolder()
    private val data = "school content".toByteArray()
    private val hash = MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }

    @Test fun onlyMatchingPendingSchoolFileTasksAreEligible() {
        for (kind in listOf("resource", "wallpaper")) for (status in listOf("queued", "waiting", "downloading", "syncing"))
            assertTrue(CachedDownloadRules.matches(kind, "id", "download", "download:id", "id", status))
        for (status in listOf("done", "installed", "removed", "failed", "superseded"))
            assertFalse(CachedDownloadRules.matches("resource", "id", "download", "download:id", "id", status))
    }

    @Test fun appsMessagesOutboxAndOtherItemTasksAreUntouched() {
        assertFalse(CachedDownloadRules.matches("app", "id", "download", "download:id", "id", "waiting"))
        assertFalse(CachedDownloadRules.matches("resource", "id", "install", "download:id", "id", "waiting"))
        for (key in listOf("message-image:id", "web-download:id", "download:other"))
            assertFalse(CachedDownloadRules.matches("resource", "id", "download", key, "id", "waiting"))
        assertFalse(CachedDownloadRules.matches("resource", "id", "download", "download:id", "other", "waiting"))
    }

    @Test fun exactFinalFileWithMatchingHashIsReady() {
        val file = temporary.newFile("note.pdf").apply { writeBytes(data) }
        assertTrue(CachedDownloadRules.ready(file, data.size.toLong(), hash.uppercase()))
    }

    @Test fun legacyFileWithoutCatalogHashStillRequiresExactKnownSize() {
        val file = temporary.newFile("wallpaper.jpg").apply { writeBytes(data) }
        assertTrue(CachedDownloadRules.ready(file, data.size.toLong(), null))
        assertFalse(CachedDownloadRules.ready(file, -1, null))
        assertFalse(CachedDownloadRules.ready(file, data.size + 1L, null))
    }

    @Test fun missingFilesDirectoriesPartialAndApkFilesAreNotReady() {
        assertFalse(CachedDownloadRules.ready(java.io.File(temporary.root, "absent"), 0, null))
        assertFalse(CachedDownloadRules.ready(temporary.newFolder("directory"), 0, null))
        for (name in listOf("note.pdf.part", "base.APK", "app.PSAPK")) {
            val file = temporary.newFile(name).apply { writeBytes(data) }
            assertFalse(CachedDownloadRules.ready(file, data.size.toLong(), hash))
            assertArrayEquals(data, file.readBytes())
        }
    }

    @Test fun damagedOrMalformedHashesLeaveTaskPendingAndFileUntouched() {
        val file = temporary.newFile("note.jpg").apply { writeBytes(data) }
        for (expected in listOf("0".repeat(64), "invalid", "null"))
            assertFalse(CachedDownloadRules.ready(file, data.size.toLong(), expected))
        assertArrayEquals(data, file.readBytes())
    }

    @Test(expected = CancellationException::class)
    fun hashingRemainsCooperativelyCancellable() {
        val file = temporary.newFile("note.jpg").apply { writeBytes(data) }
        CachedDownloadRules.ready(file, data.size.toLong(), hash) { throw CancellationException("manual sync") }
    }
}
