package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Test
import org.junit.Rule
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class ApkSetInspectorTest {
    @get:Rule val temp = TemporaryFolder()
    private val android = "http://schemas.android.com/apk/res/android"
    private data class Attr(val name: String, val value: String, val type: Int = 3, val namespace: String = "")
    private fun a(name: String, value: String, type: Int = 3) = Attr(name, value, type, android)

    /** Small binary AXML fixture writer: tests the actual pinned parser, not a JSON surrogate. */
    private fun manifest(root: List<Attr>, children: List<Pair<String, List<Attr>>> = emptyList()): ByteArray {
        val strings = linkedSetOf("manifest")
        (listOf("manifest" to root) + children).forEach { (name, attrs) ->
            strings += name
            attrs.forEach { strings += it.name; strings += it.value; if (it.namespace.isNotEmpty()) strings += it.namespace }
        }
        val pool = strings.toList()
        fun index(s: String) = pool.indexOf(s)
        fun buffer(size: Int) = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN)
        val text = ByteArrayOutputStream()
        val offsets = pool.map { value ->
            val offset = text.size()
            val bytes = value.toByteArray(Charsets.UTF_8)
            require(bytes.size < 128)
            text.write(value.length); text.write(bytes.size); text.write(bytes); text.write(0)
            offset
        }
        while (text.size() % 4 != 0) text.write(0)
        val poolSize = 28 + pool.size * 4 + text.size()
        val stringChunk = buffer(poolSize).apply {
            putShort(1); putShort(28); putInt(poolSize); putInt(pool.size); putInt(0)
            putInt(0x100); putInt(28 + pool.size * 4); putInt(0)
            offsets.forEach { putInt(it) }; put(text.toByteArray())
        }.array()
        fun start(name: String, attrs: List<Attr>): ByteArray = buffer(36 + 20 * attrs.size).apply {
            putShort(0x102); putShort(16); putInt(capacity()); putInt(1); putInt(-1)
            putInt(-1); putInt(index(name)); putShort(20); putShort(20); putShort(attrs.size.toShort())
            putShort(0); putShort(0); putShort(0)
            attrs.forEach { attr ->
                putInt(if (attr.namespace.isEmpty()) -1 else index(attr.namespace)); putInt(index(attr.name))
                putInt(if (attr.type == 3) index(attr.value) else -1)
                putShort(8); put(0); put(attr.type.toByte())
                putInt(if (attr.type == 3) index(attr.value) else attr.value.toInt())
            }
        }.array()
        fun end(name: String): ByteArray = buffer(24).apply {
            putShort(0x103); putShort(16); putInt(24); putInt(1); putInt(-1); putInt(-1); putInt(index(name))
        }.array()
        val chunks = listOf(stringChunk, start("manifest", root)) +
            children.flatMap { (name, attrs) -> listOf(start(name, attrs), end(name)) } + listOf(end("manifest"))
        return buffer(8 + chunks.sumOf { it.size }).apply {
            putShort(3); putShort(8); putInt(capacity()); chunks.forEach { put(it) }
        }.array()
    }
    private fun parse(root: List<Attr>, children: List<Pair<String, List<Attr>>> = emptyList()) =
        ApkSetInspector.parseManifest(manifest(root, children), File("base.apk"), setOf("signer"))

    @Test fun readsActualBinaryManifestPackageVersionAndMinimumSdk() {
        val info = parse(listOf(Attr("package", "org.example.app"), a("versionCode", "123", 16), a("versionCodeMajor", "2", 16)),
            listOf("uses-sdk" to listOf(a("minSdkVersion", "30", 16))))
        assertEquals("org.example.app", info.packageName)
        assertEquals((2L shl 32) + 123, info.versionCode)
        assertEquals(30, info.minSdk)
        assertNull(info.splitName)
    }
    @Test fun readsStandaloneSplitAndDependenciesWithoutPackageManager() {
        val info = parse(listOf(Attr("package", "org.example.app"), Attr("split", "config.arm64"), Attr("configForSplit", "feature"),
            a("requiredSplitTypes", "abi, density"), a("splitTypes", "abi"), a("isSplitRequired", "1", 18)),
            listOf("uses-split" to listOf(a("name", "feature"))))
        assertEquals("config.arm64", info.splitName)
        assertEquals("feature", info.configForSplit)
        assertEquals(setOf("feature"), info.usesSplits)
        assertEquals(setOf("abi", "density"), info.requiredSplitTypes)
        assertEquals(setOf("abi"), info.splitTypes)
        assertTrue(info.splitRequired)
    }
    @Test fun rejectsPreviewSdkAndResourceReferencesRatherThanGuessing() {
        for (sdk in listOf(a("minSdkVersion", "FutureAndroid"), a("minSdkVersion", "123", 1))) {
            assertThrows(Exception::class.java) {
                parse(listOf(Attr("package", "org.example.app")), listOf("uses-sdk" to listOf(sdk)))
            }
        }
    }
    @Test fun rejectsInvalidBinaryAndMissingPackage() {
        assertThrows(Exception::class.java) { ApkSetInspector.parseManifest(byteArrayOf(1, 2, 3), File("base.apk"), setOf("cert")) }
        assertThrows(Exception::class.java) { parse(emptyList()) }
    }
    @Test fun rejectsUnsignedApkEvenWhenItsBinaryManifestIsValid() {
        val file = temp.newFile("unsigned.apk")
        ZipOutputStream(file.outputStream()).use { zip ->
            zip.putNextEntry(ZipEntry("AndroidManifest.xml"))
            zip.write(manifest(listOf(Attr("package", "org.example.app"), a("versionCode", "1", 16))))
            zip.closeEntry()
        }
        assertThrows(Exception::class.java) { ApkSetInspector.inspect(file, 30) }
    }
}
