package com.robokorda.primesecure

/** Explicit student-app exceptions only; never weaken the blanket firmware guard for strict mode. */
internal object ManualAppHides {
    /** Safe, nonessential student-facing apps hidden on every managed school image. */
    val firmwareDefaults=setOf(
        "com.google.android.googlequicksearchbox",
        "com.google.android.youtube",
        "com.floydwiz.browser",
        "com.floydwiz.primestore",
        "com.floydwiz.primeos.mdm",
        "com.floydwiz.primeos.appcompat",
        "com.android.vending",
        "com.floydwiz.primefilemanager",
        "com.floydwiz.updater",
        "com.floydwiz.youtube",
        "com.google.android.apps.photosgo",
        "com.floydwiz.myprimebook",
        "com.android.deskclock",
        "com.google.android.deskclock",
        "com.floydwiz.clock",
    )
    val groups=mapOf(
        "com.google.android.googlequicksearchbox" to setOf("com.google.android.googlequicksearchbox"),
        "com.google.android.youtube" to setOf("com.google.android.youtube","com.google.android.youtube.tv"),
        "com.floydwiz.browser" to setOf("com.floydwiz.browser","com.android.browser","com.android.chrome","org.chromium.chrome","com.google.android.apps.chrome"),
        "com.floydwiz.manual" to setOf("com.floydwiz.manual"),
        "com.floydwiz.primestore" to setOf("com.floydwiz.primestore"),
        "com.floydwiz.primeos.mdm" to setOf("com.floydwiz.primeos.mdm"),
        "com.floydwiz.primeos.appcompat" to setOf("com.floydwiz.primeos.appcompat"),
        "com.android.vending" to setOf("com.android.vending"),
        "com.google.android.contacts" to setOf("com.google.android.contacts","com.android.contacts"),
        "com.floydwiz.primefilemanager" to setOf("com.floydwiz.primefilemanager","com.floydwiz.filemanager","com.floydwiz.fileexplorer"),
        "com.floydwiz.updater" to setOf("com.floydwiz.updater"),
        "com.floydwiz.youtube" to setOf("com.floydwiz.youtube"),
        "com.google.android.apps.photosgo" to setOf("com.google.android.apps.photosgo"),
        "com.floydwiz.myprimebook" to setOf("com.floydwiz.myprimebook"),
        "com.android.deskclock" to setOf("com.android.deskclock","com.google.android.deskclock","com.floydwiz.clock"),
    )
    /** System packages deliberately allowed to stay hidden on the school image. */
    val safeSystemHides:Set<String> get()=expanded(firmwareDefaults)
    fun expanded(requested:Set<String>):Set<String> = requested + groups.filterKeys { it in requested }.values.flatten()
    fun firmwareExceptions(requested:Set<String>,essential:Set<String>,unlocked:Boolean,screenUnlocked:Boolean,uptimeMs:Long):Set<String> {
        if(!unlocked||!screenUnlocked||uptimeMs<120_000)return emptySet()
        return expanded(requested).intersect(groups.values.flatten().toSet())-essential
    }
}
