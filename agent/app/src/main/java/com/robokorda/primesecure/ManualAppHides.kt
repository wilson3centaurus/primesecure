package com.robokorda.primesecure

/** Explicit student-app exceptions only; never weaken the blanket firmware guard for strict mode. */
internal object ManualAppHides {
    val groups=mapOf(
        "com.google.android.googlequicksearchbox" to setOf("com.google.android.googlequicksearchbox"),
        "com.floydwiz.browser" to setOf("com.floydwiz.browser","com.android.browser","com.android.chrome","org.chromium.chrome","com.google.android.apps.chrome"),
        "com.floydwiz.manual" to setOf("com.floydwiz.manual"),
        "com.floydwiz.primestore" to setOf("com.floydwiz.primestore"),
        "com.google.android.contacts" to setOf("com.google.android.contacts","com.android.contacts"),
        "com.floydwiz.primefilemanager" to setOf("com.floydwiz.primefilemanager","com.floydwiz.filemanager","com.floydwiz.fileexplorer"),
    )
    fun expanded(requested:Set<String>):Set<String> = requested + groups.filterKeys { it in requested }.values.flatten()
    fun firmwareExceptions(requested:Set<String>,essential:Set<String>,unlocked:Boolean,screenUnlocked:Boolean,uptimeMs:Long):Set<String> {
        if(!unlocked||!screenUnlocked||uptimeMs<120_000)return emptySet()
        return expanded(requested).intersect(groups.values.flatten().toSet())-essential
    }
}
