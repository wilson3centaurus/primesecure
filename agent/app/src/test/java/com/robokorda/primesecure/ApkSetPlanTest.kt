package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class ApkSetPlanTest {
    private val base = ApkSetMember(File("base.apk"), "org.example.app", 123, signers = setOf("cert"))
    private fun split(name: String) = base.copy(file = File("$name.apk"), splitName = name)
    private fun plan(vararg members: ApkSetMember, sdk: Int = 26, abis: List<String> = listOf("arm64-v8a", "armeabi-v7a")) =
        ApkSetPlan.create(members.toList(), sdk, abis)
    private fun rejects(vararg members: ApkSetMember) {
        assertThrows(Exception::class.java) { plan(*members) }
    }
    @Test fun stagesBaseFirstAndEverySplitOnceInOnePlan() {
        val a = split("config.arm64")
        val z = split("feature.z")
        val files = plan(z, a, base)
        assertEquals(listOf("base.apk", "split-0.apk", "split-1.apk"), files.map { it.name })
        assertEquals(listOf(base.file, a.file, z.file), files.map { it.file })
        assertEquals(files, plan(a, base, z))
    }
    @Test fun allowsMonolithicBaseSet() { assertEquals(1, plan(base).size) }
    @Test fun rejectsMissingOrDuplicateBaseAndWrongBaseFilename() {
        rejects(split("a")); rejects(base, base.copy(file = File("other.apk")))
        rejects(base.copy(file = File("other.apk")))
    }
    @Test fun rejectsDuplicateManifestSplitEvenWithDifferentFilenames() {
        rejects(base, split("a"), split("a").copy(file = File("another.apk")))
    }
    @Test fun rejectsPackageVersionAndSignerMismatches() {
        rejects(base, split("a").copy(packageName = "other.app"))
        rejects(base, split("a").copy(versionCode = 124))
        rejects(base, split("a").copy(versionCode = (1L shl 32) + 123))
        rejects(base, split("a").copy(signers = setOf("other")))
        rejects(base.copy(signers = emptySet()))
    }
    @Test fun usesActualSdkForEveryMember() {
        assertEquals(1, plan(base.copy(minSdk = 30), sdk = 30).size)
        rejects(base.copy(minSdk = 27))
        rejects(base, split("a").copy(minSdk = 27))
    }
    @Test fun checksRequiredDeclaredSplitDependencies() {
        rejects(base.copy(usesSplits = setOf("feature")))
        rejects(base, split("config").copy(configForSplit = "feature"))
        assertEquals(3, plan(base, split("feature"), split("config").copy(configForSplit = "feature")).size)
        rejects(base.copy(splitRequired = true))
        assertEquals(2, plan(base.copy(splitRequired = true), split("a")).size)
        rejects(base.copy(requiredSplitTypes = setOf("abi")), split("a"))
        assertEquals(2, plan(base.copy(requiredSplitTypes = setOf("abi")), split("a").copy(splitTypes = setOf("abi"))).size)
    }
    @Test fun acceptsArmX86AndJavaOnlyUsingProvidedDeviceAbis() {
        assertEquals(1, plan(base).size)
        assertEquals(1, plan(base.copy(nativeLibraries = mapOf("a.so" to setOf("arm64-v8a")))).size)
        assertEquals(1, plan(base.copy(nativeLibraries = mapOf("a.so" to setOf("x86_64"))), abis = listOf("x86_64", "x86")).size)
        rejects(base.copy(nativeLibraries = mapOf("a.so" to setOf("x86"))))
    }
    @Test fun aggregatesAbiVariantsAcrossSplitsButRequiresOneCommonAbi() {
        assertEquals(3, plan(base, split("arm").copy(nativeLibraries = mapOf("a.so" to setOf("arm64-v8a"))),
            split("x86").copy(nativeLibraries = mapOf("a.so" to setOf("x86")))).size)
        rejects(base.copy(nativeLibraries = mapOf("a.so" to setOf("arm64-v8a"))),
            split("feature").copy(nativeLibraries = mapOf("b.so" to setOf("armeabi-v7a"))))
    }
    @Test fun existingSameVersionBaseCanBeRepairedWithoutAnUninstall() {
        assertTrue(ApkSetPlan.shouldInstall(true, true, false, false))
        assertTrue(ApkSetPlan.shouldInstall(true, false, true, false))
        assertTrue(ApkSetPlan.shouldInstall(true, false, false, true))
        assertTrue(ApkSetPlan.shouldInstall(false, false, false, false))
        assertFalse(ApkSetPlan.shouldInstall(true, false, false, false))
    }
    @Test fun standaloneCacheFilenameIsAllowedButIncompleteOrSplitOnlyApkIsRejected() {
        val downloaded = base.copy(file = File("install-hash.apk"))
        assertEquals(downloaded.file, ApkSetPlan.single(downloaded, 30, listOf("arm64-v8a")).single().file)
        for (incomplete in listOf(downloaded.copy(splitRequired = true), downloaded.copy(usesSplits = setOf("feature")),
                downloaded.copy(requiredSplitTypes = setOf("abi")), split("config.en"))) {
            val error = assertThrows(Exception::class.java) { ApkSetPlan.single(incomplete, 30, listOf("arm64-v8a")) }
            assertTrue("Repair guidance should name the complete set", error.message.orEmpty().contains(".psapk"))
        }
    }
}
