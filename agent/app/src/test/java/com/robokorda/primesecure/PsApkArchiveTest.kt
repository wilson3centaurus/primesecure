package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class PsApkArchiveTest {
    @get:Rule val temp = TemporaryFolder()

    private fun archive(vararg entries: Pair<String, ByteArray>): File = temp.newFile().apply {
        ZipOutputStream(outputStream()).use { zip -> entries.forEach { (name, bytes) ->
            zip.putNextEntry(ZipEntry(name)); zip.write(bytes); zip.closeEntry()
        } }
    }
    private fun destination() = File(temp.root, "extract-${System.nanoTime()}")
    private fun rejects(file: File, maxBytes: Long = PsApkArchive.MAX_BYTES, count: Int = 100) {
        val target = destination()
        assertThrows(Exception::class.java) { PsApkArchive.extract(file, target, maxBytes, count) }
        assertFalse("Failed extraction must remove its cache", target.exists())
    }

    @Test fun preservesEveryApkByteAndSupportsCaseInsensitiveNames() {
        val base = ByteArray(400) { it.toByte() }
        val split = byteArrayOf(0, 1, 2, -1)
        val files = PsApkArchive.extract(archive("BASE.APK" to base, "split_config.arm64_v8a.apk" to split), destination())
        assertEquals(2, files.size)
        assertArrayEquals(base, files.first().readBytes())
        assertArrayEquals(split, files.last().readBytes())
    }
    @Test fun rejectsTraversalDirectoriesAndExtraFormats() {
        for (name in listOf("../split.apk", "/split.apk", "dir/split.apk", "dir\\split.apk", "C:split.apk",
                "toc.pb", "info.json", "folder/", ".hidden.apk", "a apk.apk", "a.apk\n", "\u212A.apk", "\u017F.apk")) {
            rejects(archive("base.apk" to byteArrayOf(1), name to byteArrayOf(2)))
        }
    }
    @Test fun filenameLengthMatchesContract() {
        PsApkArchive.extract(archive("base.apk" to byteArrayOf(1), "a".repeat(180) + ".apk" to byteArrayOf(2)), destination())
        rejects(archive("base.apk" to byteArrayOf(1), "a".repeat(181) + ".apk" to byteArrayOf(2)))
    }
    @Test fun requiresBaseAndAtLeastOneNonemptyEntry() {
        rejects(archive())
        rejects(archive("split.apk" to byteArrayOf(1)))
        rejects(archive("base.apk" to byteArrayOf()))
    }
    @Test fun rejectsCaseInsensitiveDuplicateNames() {
        rejects(archive("base.apk" to byteArrayOf(1), "BASE.APK" to byteArrayOf(2)))
        rejects(archive("base.apk" to byteArrayOf(1), "split.apk" to byteArrayOf(2), "SPLIT.apk" to byteArrayOf(3)))
    }
    @Test fun allows100ButRejects101Entries() {
        val entries = (0..99).map { (if (it == 0) "base.apk" else "split$it.apk") to byteArrayOf(1) }
        assertEquals(100, PsApkArchive.extract(archive(*entries.toTypedArray()), destination()).size)
        rejects(archive(*(entries + ("extra.apk" to byteArrayOf(1))).toTypedArray()))
    }
    @Test fun rejectsCompressedDownloadLimitBeforeExtraction() {
        val file = archive("base.apk" to ByteArray(800) { (it * 37).toByte() })
        rejects(file, file.length() - 1)
    }
    @Test fun rejectsAggregateUncompressedLimitAndZipBomb() {
        rejects(archive("base.apk" to ByteArray(600), "split.apk" to ByteArray(600)), 1000)
        rejects(archive("base.apk" to ByteArray(10_000)), 1000)
    }
    @Test fun permitsExactUncompressedLimit() {
        val files = PsApkArchive.extract(archive("base.apk" to ByteArray(1000)), destination(), 1000)
        assertEquals(1000L, files.single().length())
    }
    @Test fun actualBytesCannotExceedForgedDeclaredSize() {
        val file = archive("base.apk" to ByteArray(2000))
        val bytes = file.readBytes()
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val central = (0..bytes.size - 4).first { buffer.getInt(it) == 0x02014b50 }
        buffer.putInt(central + 24, 1)
        file.writeBytes(bytes)
        rejects(file, 1000)
    }
    @Test fun checksCrcAndCleansPartialFiles() {
        val file = archive("base.apk" to ByteArray(800))
        val bytes = file.readBytes()
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val central = (0..bytes.size - 4).first { buffer.getInt(it) == 0x02014b50 }
        buffer.putInt(central + 16, 123)
        file.writeBytes(bytes)
        rejects(file)
    }
    @Test fun cancellationCleansExtractedCache() {
        val file = archive("base.apk" to ByteArray(1000))
        val target = destination()
        var checks = 0
        assertThrows(java.util.concurrent.CancellationException::class.java) {
            PsApkArchive.extract(file, target, checkCancelled = { if (++checks == 3) throw java.util.concurrent.CancellationException() })
        }
        assertFalse(target.exists())
    }
    @Test fun refusesExistingDestinationWithoutTouchingIt() {
        val target = temp.newFolder()
        val prior = File(target, "keep").apply { writeText("owned by someone else") }
        assertThrows(IllegalArgumentException::class.java) { PsApkArchive.extract(archive("base.apk" to byteArrayOf(1)), target) }
        assertTrue(prior.exists())
    }
    @Test fun recognizesOnlyExplicitPathExtension() {
        assertTrue(PsApkArchive.isSet("school/id/App.PSAPK"))
        assertFalse(PsApkArchive.isSet("school/id/App.psapk.apk"))
        assertFalse(PsApkArchive.isSet("school/id/App.psapk?file=x.apk"))
    }
}
