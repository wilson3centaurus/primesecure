package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.security.MessageDigest
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** Optional read-only validation against a complete folder copied from a real device.
 * Run with PRIMESECURE_APK_SAMPLE_DIR pointing at that folder. No device is installed. */
class ApkSetSampleTest {
    @get:Rule val temp = TemporaryFolder()

    @Test fun validatesRealSignedApksThroughContainerExtractionAndSessionPlanning() {
        val folder = System.getenv("PRIMESECURE_APK_SAMPLE_DIR")?.let(::File)
        assumeTrue("Set PRIMESECURE_APK_SAMPLE_DIR to validate actual APKs", folder?.isDirectory == true)
        val sources = folder!!.listFiles()!!.filter { it.name.endsWith(".apk", true) }.sortedBy { it.name }
        assertTrue("A complete sample needs base.apk", sources.any { it.name.equals("base.apk", true) })
        val container = temp.newFile("sample.psapk")
        ZipOutputStream(container.outputStream()).use { zip -> sources.forEach { file ->
            zip.putNextEntry(ZipEntry(file.name)); file.inputStream().use { it.copyTo(zip) }; zip.closeEntry()
        } }
        val extracted = PsApkArchive.extract(container, File(temp.root, "apks"))
        fun hash(file: File): String {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
            }
            return digest.digest().joinToString("") { "%02x".format(it) }
        }
        assertEquals(sources.associate { it.name to hash(it) }, extracted.associate { it.name to hash(it) })
        val members = extracted.map { ApkSetInspector.inspect(it, 30) }
        val abis = members.flatMap { it.nativeLibraries.values.flatten() }.distinct()
        val plan = ApkSetPlan.create(members, 30, abis)
        assertEquals(sources.size, plan.size)
        assertEquals(1, members.map { it.signers }.distinct().size)
        assertTrue(members.all { it.signers.isNotEmpty() })
        val base = members.single { it.splitName == null }
        if (base.splitRequired || base.requiredSplitTypes.isNotEmpty() || base.usesSplits.isNotEmpty()) {
            val failure = assertThrows(Exception::class.java) { ApkSetPlan.single(base, 30, abis) }
            assertTrue(failure.message.orEmpty().contains(".psapk"))
        }
        if (abis.isNotEmpty()) assertThrows(IllegalArgumentException::class.java) {
            ApkSetPlan.create(members, 30, listOf("unsupported-test-abi"))
        }
        println("Actual APK sample: package=${members.first().packageName}, version=${members.first().versionCode}, " +
            "apks=${members.size}, minSdk=${members.maxOf { it.minSdk }}, nativeAbis=$abis, verifiedSignerSets=1, " +
            "unchangedBytes=true, baseDeclaresSplits=${base.splitRequired || base.requiredSplitTypes.isNotEmpty() || base.usesSplits.isNotEmpty()}")

        // Alter only our temporary copy's v2/v3 signing block. ZIP entries and the
        // binary manifest still parse, but signature verification must reject it.
        val damaged = temp.newFile("tampered.apk")
        base.file.copyTo(damaged, overwrite = true)
        RandomAccessFile(damaged, "rw").use { file ->
            val start = (file.length() - 1024 * 1024).coerceAtLeast(0)
            file.seek(start)
            val tail = ByteArray((file.length() - start).toInt()).also { file.readFully(it) }
            val magic = "APK Sig Block 42".toByteArray(Charsets.US_ASCII)
            val position = (0..tail.size - magic.size).lastOrNull { index -> magic.indices.all { tail[index + it] == magic[it] } }
            assertNotNull("Expected a v2/v3 signed sample", position)
            val size = ByteBuffer.wrap(tail).order(ByteOrder.LITTLE_ENDIAN).getLong(position!! - 8)
            var pairOffset = start + position + 8 - size + 8
            val valueOffsets = mutableListOf<Long>()
            while (pairOffset < start + position - 8) {
                file.seek(pairOffset)
                val header = ByteArray(12).also { file.readFully(it) }
                val pair = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
                val length = pair.long
                val id = pair.int
                require(length >= 4 && length <= size)
                if (id in setOf(0x7109871a, 0xf05368c0.toInt(), 0x1b93ad61)) {
                    valueOffsets += pairOffset + 12
                }
                pairOffset += 8 + length
            }
            assertTrue("Expected a v2/v3 signer block", valueOffsets.isNotEmpty())
            valueOffsets.forEach { offset ->
                file.seek(offset)
                val value = file.read()
                file.seek(offset)
                file.write(value xor 1)
            }
        }
        assertThrows(Exception::class.java) { ApkSetInspector.inspect(damaged, 30) }
    }
}
