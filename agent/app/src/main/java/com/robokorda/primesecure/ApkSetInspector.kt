package com.robokorda.primesecure

import com.android.apksig.ApkVerifier
import com.android.apksig.internal.apk.AndroidBinXmlParser
import java.io.File
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.zip.ZipFile

/** Uses the pinned apksig binary manifest reader, including for standalone split APKs
 * which PackageManager.getPackageArchiveInfo cannot reliably inspect on older Android. */
object ApkSetInspector {
    private const val ANDROID = "http://schemas.android.com/apk/res/android"
    private const val MAX_MANIFEST_BYTES = 4 * 1024 * 1024

    fun inspect(file: File, sdk: Int): ApkSetMember {
        // Bound the manifest before handing the APK to the signature verifier, whose
        // manifest reader otherwise trusts its declared uncompressed size.
        val parsed = ZipFile(file).use { zip ->
            val manifests = zip.entries().asSequence().filter { it.name == "AndroidManifest.xml" }.toList()
            require(manifests.size == 1) { "APK must contain one AndroidManifest.xml" }
            val entry = manifests.single()
            require(entry.size in 1..MAX_MANIFEST_BYTES.toLong()) { "APK manifest is too large" }
            val bytes = zip.getInputStream(entry).use { it.readBytesBounded(MAX_MANIFEST_BYTES) }
            val manifest = parseManifest(bytes, file, emptySet())
            val libraries = mutableMapOf<String, MutableSet<String>>()
            zip.entries().asSequence().forEach { native ->
                val parts = native.name.split('/')
                if (!native.isDirectory && parts.size == 3 && parts[0] == "lib" && parts[2].endsWith(".so")) {
                    libraries.getOrPut(parts[2]) { mutableSetOf() }.add(parts[1])
                }
            }
            manifest.copy(nativeLibraries = libraries)
        }
        val verified = ApkVerifier.Builder(file).setMinCheckedPlatformVersion(sdk)
            .setMaxCheckedPlatformVersion(sdk).build().verify()
        require(verified.isVerified) { "APK signature verification failed: ${file.name}" }
        val signers = verified.signerCertificates.map { certificate ->
            MessageDigest.getInstance("SHA-256").digest(certificate.encoded).joinToString("") { "%02x".format(it) }
        }.toSet()
        return parsed.copy(signers = signers)
    }

    internal fun parseManifest(bytes: ByteArray, file: File, signers: Set<String>): ApkSetMember {
        require(bytes.size <= MAX_MANIFEST_BYTES) { "APK manifest is too large" }
        val parser = AndroidBinXmlParser(ByteBuffer.wrap(bytes))
        var pkg: String? = null
        var version = 0L
        var major = 0L
        var split: String? = null
        var minSdk = 1
        var versionName: String? = null
        var config: String? = null
        var splitRequired = false
        var requiredTypes = emptySet<String>()
        var types = emptySet<String>()
        val dependencies = mutableSetOf<String>()
        fun attribute(name: String, namespace: String = ANDROID): Int? = (0 until parser.attributeCount).firstOrNull {
            parser.getAttributeName(it) == name && parser.getAttributeNamespace(it).orEmpty() == namespace
        }
        fun string(name: String, namespace: String = ANDROID): String? = attribute(name, namespace)?.let {
            require(parser.getAttributeValueType(it) == AndroidBinXmlParser.VALUE_TYPE_STRING) { "Unsupported manifest attribute: $name" }
            parser.getAttributeStringValue(it).takeIf(String::isNotEmpty)
        }
        fun integer(name: String, default: Int): Int = attribute(name)?.let {
            when (parser.getAttributeValueType(it)) {
                AndroidBinXmlParser.VALUE_TYPE_INT -> parser.getAttributeIntValue(it)
                AndroidBinXmlParser.VALUE_TYPE_STRING -> parser.getAttributeStringValue(it).toIntOrNull()
                    ?: error("Unsupported preview SDK or integer in $name")
                else -> error("Unsupported manifest integer: $name")
            }
        } ?: default
        fun boolean(name: String): Boolean = attribute(name)?.let {
            require(parser.getAttributeValueType(it) == AndroidBinXmlParser.VALUE_TYPE_BOOLEAN) { "Unsupported manifest boolean: $name" }
            parser.getAttributeBooleanValue(it)
        } ?: false
        fun typeSet(name: String) = string(name)?.split(',')?.map { it.trim() }?.filter(String::isNotEmpty)?.toSet() ?: emptySet()
        while (parser.next() != AndroidBinXmlParser.EVENT_END_DOCUMENT) {
            if (parser.eventType != AndroidBinXmlParser.EVENT_START_ELEMENT) continue
            when {
                parser.depth == 1 -> {
                    require(parser.name == "manifest" && pkg == null) { "Invalid APK manifest root" }
                    pkg = string("package", "") ?: error("Missing APK package")
                    split = string("split", "")
                    version = integer("versionCode", 0).toLong() and 0xffffffffL
                    major = integer("versionCodeMajor", 0).toLong() and 0xffffffffL
                    versionName = attribute("versionName")?.takeIf {
                        parser.getAttributeValueType(it) == AndroidBinXmlParser.VALUE_TYPE_STRING
                    }?.let { parser.getAttributeStringValue(it) }
                    config = string("configForSplit", "")
                    requiredTypes = typeSet("requiredSplitTypes")
                    types = typeSet("splitTypes")
                    splitRequired = boolean("isSplitRequired")
                }
                parser.depth == 2 && parser.name == "uses-sdk" -> {
                    minSdk = integer("minSdkVersion", 1)
                    require(minSdk >= 1) { "Invalid minimum SDK" }
                }
                parser.depth == 2 && parser.name == "uses-split" -> dependencies += string("name") ?: error("Missing uses-split name")
                parser.depth == 2 && parser.name == "application" -> splitRequired = splitRequired || boolean("isSplitRequired")
                parser.depth == 3 && parser.name == "meta-data" && string("name") == "com.android.vending.splits.required" ->
                    splitRequired = splitRequired || boolean("value")
            }
        }
        return ApkSetMember(file, pkg ?: error("Missing APK manifest"), (major shl 32) or version,
            split, minSdk, signers, dependencies, config, splitRequired, requiredTypes, types, versionName = versionName)
    }

    private fun java.io.InputStream.readBytesBounded(limit: Int): ByteArray {
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val count = read(buffer)
            if (count < 0) break
            require(count <= limit - output.size()) { "APK manifest is too large" }
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }
}
