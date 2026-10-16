package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Test

class ActiveRoleSafetyTest {
    private val google="com.google.android.googlequicksearchbox"
    private val desktop="com.floydwiz.launcher"
    @Test fun optionalGoogleHomeIsNotTheSelectedDesktop() {
        assertEquals(setOf(desktop),ActiveRoleSafety.protectedPackages(desktop,setOf(desktop,google)))
    }
    @Test fun googleIsKeptWhenItActuallyProvidesTheDesktop() {
        assertEquals(setOf(google),ActiveRoleSafety.protectedPackages(google,setOf(desktop,google)))
    }
    @Test fun unresolvedChooserKeepsCandidatesSafe() {
        assertEquals(setOf(desktop,google),ActiveRoleSafety.protectedPackages("android",setOf(desktop,google)))
        assertEquals(setOf(desktop,google),ActiveRoleSafety.protectedPackages(null,setOf(desktop,google)))
    }
    @Test fun inactiveVoiceInputDoesNotProtectGoogleSearch() {
        assertEquals(setOf("com.android.inputmethod.latin"),ActiveRoleSafety.protectedPackages("com.android.inputmethod.latin",setOf("com.android.inputmethod.latin",google)))
    }
    @Test fun unknownKeyboardKeepsAvailableKeyboardsProtected() {
        assertEquals(setOf("com.android.inputmethod.latin",google),ActiveRoleSafety.protectedPackages(null,setOf("com.android.inputmethod.latin",google)))
    }
}
