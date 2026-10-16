package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Test

class ManualAppHidesTest {
    @Test fun strictModeAloneNeverMakesFirmwareExceptions() {
        assertTrue(ManualAppHides.firmwareExceptions(emptySet(),emptySet(),true,true,500000).isEmpty())
    }
    @Test fun manualBrowserRequestExpandsKnownAliasesOnly() {
        val result=ManualAppHides.firmwareExceptions(setOf("com.floydwiz.browser"),emptySet(),true,true,500000)
        assertTrue(result.containsAll(setOf("com.android.browser","com.android.chrome")))
        assertFalse(result.contains("com.google.android.googlequicksearchbox"))
        assertFalse(result.contains("com.floydwiz.primestore"))
    }
    @Test fun activeWebViewAndCoreRolesAlwaysWinOverAnExplicitRequest() {
        val essential=setOf("com.android.chrome","com.floydwiz.primestore","com.android.settings","keyboard","launcher")
        val result=ManualAppHides.firmwareExceptions(setOf("com.floydwiz.browser","com.floydwiz.primestore","com.android.settings","keyboard","launcher"),essential,true,true,500000)
        assertTrue(result.intersect(essential).isEmpty())
    }
    @Test fun noFirmwareHidingBeforeUnlockOrWhileKeyguardIsLockedOrDuringStartupGrace() {
        val request=setOf("com.floydwiz.primestore")
        assertTrue(ManualAppHides.firmwareExceptions(request,emptySet(),false,true,500000).isEmpty())
        assertTrue(ManualAppHides.firmwareExceptions(request,emptySet(),true,false,500000).isEmpty())
        assertTrue(ManualAppHides.firmwareExceptions(request,emptySet(),true,true,119999).isEmpty())
        assertEquals(request,ManualAppHides.firmwareExceptions(request,emptySet(),true,true,120000))
    }
    @Test fun arbitraryFirmwareAndSettingsNeverBecomeExceptions() {
        assertTrue(ManualAppHides.firmwareExceptions(setOf("oem.login","com.android.settings","com.google.android.gms","com.android.documentsui"),emptySet(),true,true,500000).isEmpty())
    }
}
