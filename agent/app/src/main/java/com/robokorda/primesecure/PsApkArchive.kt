package com.robokorda.primesecure

import java.io.File
import java.util.Locale
import java.util.zip.CRC32
import java.util.zip.ZipFile
import java.security.MessageDigest

/** The same integrity check protects monolithic APKs and .psapk downloads. */
object ApkDownloadHash {
    fun expectedForSource(value: String?, legacySingleApk: Boolean): String? =
        if (legacySingleApk && value == null) null else expected(value)

    fun expected(value: String?): String {
        require(value != null && Regex("[A-Fa-f0-9]{64}").matches(value)) {
            "App download needs a valid SHA-256 hash. Ask your school to re-upload this app."
        }
        return value
    }

    fun verify(file: File, expected: String, checkCancelled: () -> Unit = {}) {
        ApkDownloadHash.expected(expected)
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                checkCancelled()
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        check(digest.digest().joinToString("") { "%02x".format(it) }.equals(expected, true)) {
            "The app download is damaged. Please retry."
        }
    }
}

/** A .psapk contains only original, signed APK bytes; it is not a bundletool archive. */
object PsApkArchive {
    const val MIME = "application/vnd.primesecure.apk-set+zip"
    const val MAX_BYTES = 500_000_000L
    const val MAX_ENTRIES = 100
    // Explicit ASCII casing avoids Java's Unicode case folding (for example Kelvin sign).
    private val apkName = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,179}\\.[aA][pP][kK]")

    fun isSet(path: String) = path.endsWith(".psapk", ignoreCase = true)

    /** [destination] must be a new, private directory owned by this attempt. */
    fun extract(
        archive: File, destination: File, maxBytes: Long = MAX_BYTES,
        maxEntries: Int = MAX_ENTRIES, checkCancelled: () -> Unit = {},
    ): List<File> {
        require(maxBytes in 1..MAX_BYTES && maxEntries in 1..MAX_ENTRIES)
        require(archive.length() in 1..maxBytes) { "APK set download exceeds the size limit or is empty" }
        require(!destination.exists() && destination.mkdirs()) { "Could not create APK set cache" }
        try {
            return ZipFile(archive).use { zip ->
                val entries = mutableListOf<java.util.zip.ZipEntry>()
                val names = mutableSetOf<String>()
                var declared = 0L
                val enumeration = zip.entries()
                while (enumeration.hasMoreElements()) {
                    checkCancelled()
                    val entry = enumeration.nextElement()
                    require(entries.size < maxEntries) { "Too many APKs in the set" }
                    require(!entry.isDirectory && apkName.matches(entry.name)) { "APK set must contain only root APK files" }
                    require(names.add(entry.name.lowercase(Locale.ROOT))) { "Duplicate APK filename" }
                    require(entry.size > 0 && entry.size <= maxBytes - declared) { "APK set exceeds the uncompressed size limit" }
                    declared += entry.size
                    entries += entry
                }
                require(entries.isNotEmpty() && "base.apk" in names) { "APK set needs base.apk" }
                var total = 0L
                entries.map { entry ->
                    val target = File(destination, entry.name)
                    require(target.canonicalFile.parentFile == destination.canonicalFile) { "Unsafe APK filename" }
                    val crc = CRC32()
                    var size = 0L
                    zip.getInputStream(entry).use { input -> target.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            checkCancelled()
                            val count = input.read(buffer)
                            if (count < 0) break
                            require(count.toLong() <= maxBytes - total && count.toLong() <= entry.size - size) {
                                "APK set exceeds the uncompressed size limit"
                            }
                            output.write(buffer, 0, count)
                            crc.update(buffer, 0, count)
                            total += count
                            size += count
                        }
                    } }
                    require(size == entry.size && crc.value == entry.crc) { "Damaged APK set entry" }
                    target
                }
            }
        } catch (e: Throwable) {
            destination.deleteRecursively()
            throw e
        }
    }
}

data class ApkSetMember(
    val file: File,
    val packageName: String,
    val versionCode: Long,
    val splitName: String? = null,
    val minSdk: Int = 1,
    val signers: Set<String>,
    val usesSplits: Set<String> = emptySet(),
    val configForSplit: String? = null,
    val splitRequired: Boolean = false,
    val requiredSplitTypes: Set<String> = emptySet(),
    val splitTypes: Set<String> = emptySet(),
    val nativeLibraries: Map<String, Set<String>> = emptyMap(),
    val versionName: String? = null,
)

data class SessionApk(val name: String, val file: File)

/** Pure validation and deterministic session plan, shared by tests and the Android installer. */
object ApkSetPlan {
    fun create(members: List<ApkSetMember>, sdk: Int, supportedAbis: List<String>): List<SessionApk> =
        validate(members, sdk, supportedAbis, requireBaseFilename = true)

    fun single(member: ApkSetMember, sdk: Int, supportedAbis: List<String>): List<SessionApk> =
        validate(listOf(member), sdk, supportedAbis, requireBaseFilename = false)

    private fun validate(members: List<ApkSetMember>, sdk: Int, supportedAbis: List<String>, requireBaseFilename: Boolean): List<SessionApk> {
        require(members.size in 1..PsApkArchive.MAX_ENTRIES) { "Invalid APK count" }
        val base = members.singleOrNull { it.splitName == null }
            ?: error("A base APK is required. Ask your school to upload the complete .psapk set.")
        require(!requireBaseFilename || base.file.name.equals("base.apk", true)) { "base.apk must contain the base manifest" }
        require(members.map { it.file.canonicalPath }.toSet().size == members.size) { "Duplicate APK file" }
        require(members.map { it.splitName }.toSet().size == members.size) { "Duplicate manifest split name" }
        require(base.signers.isNotEmpty()) { "Unsigned APK" }
        val splits = members.mapNotNull { it.splitName }.toSet()
        val types = members.flatMap { it.splitTypes }.toSet()
        for (member in members) {
            require(member.packageName == base.packageName && member.versionCode == base.versionCode) { "APKs must have the same package and version code" }
            require(member.signers == base.signers) { "APKs must have the same signing certificates" }
            require(member.minSdk <= sdk) { "APK requires Android SDK ${member.minSdk}; this device has $sdk" }
            require(splits.containsAll(member.usesSplits)) { "Missing required split: ${member.usesSplits - splits}. Ask your school to upload the complete .psapk set." }
            require(member.configForSplit == null || member.configForSplit in splits) { "Missing configuration target split" }
            require(!member.splitRequired || splits.isNotEmpty()) { "This app requires split APKs. Ask your school to upload the complete .psapk set." }
            require(types.containsAll(member.requiredSplitTypes)) { "Missing required split types: ${member.requiredSplitTypes - types}. Ask your school to upload the complete .psapk set." }
        }
        // Every native library must have a variant for one common device ABI. Never infer ABI
        // from filenames, and never assume a Primebook is x86 rather than ARM.
        val libraries = mutableMapOf<String, MutableSet<String>>()
        members.forEach { member -> member.nativeLibraries.forEach { (name, abis) ->
            libraries.getOrPut(name) { mutableSetOf() }.addAll(abis)
        } }
        require(libraries.isEmpty() || supportedAbis.any { abi -> libraries.values.all { abi in it } }) {
            "APK native libraries are incompatible with device ABIs: ${supportedAbis.joinToString()}"
        }
        return listOf(SessionApk("base.apk", base.file)) + members.filter { it !== base }
            .sortedBy { it.splitName }.mapIndexed { index, member -> SessionApk("split-$index.apk", member.file) }
    }

    fun shouldInstall(installed: Boolean, isSet: Boolean, forced: Boolean, retry: Boolean) =
        !installed || isSet || forced || retry
}
