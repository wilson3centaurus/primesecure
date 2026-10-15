package com.robokorda.primesecure

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Locale

class EnrollmentKeyTest {
    @Test fun `typing formats on the fifth character and keeps the caret`() {
        var text = ""
        var caret = 0
        for (char in "k7qfm2xp") {
            val raw = text.substring(0, caret) + char + text.substring(caret)
            val edit = EnrollmentKey.format(raw, caret + 1)
            text = edit.text
            caret = edit.selectionStart
        }
        assertEquals("K7QF-M2XP", text)
        assertEquals(9, caret)
        assertEquals("K7QF", EnrollmentKey.format("k7qf").text)
    }

    @Test fun `paste accepts spaces and common dash variants without losing the key`() {
        for (dash in listOf("-", "\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2212", "\uff0d")) {
            assertEquals("K7QF-M2XP", EnrollmentKey.format(" \tk7qf $dash m2xp\n").text)
            assertEquals("K7QF-M2XP", EnrollmentKey.canonical("\u00a0k7qf${dash}m2xp\u00a0"))
        }
    }

    @Test fun `ambiguous letters match server canonicalization independently of locale`() {
        val previous = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("tr-TR"))
            assertEquals("1100-ABCD", EnrollmentKey.canonical("iloo-abcd"))
        } finally {
            Locale.setDefault(previous)
        }
    }

    @Test fun `invalid and extra characters stay visible and never become valid requests`() {
        assertEquals("K7?F-M2XP", EnrollmentKey.format("k7?fm2xp").text)
        assertEquals(EnrollmentKey.Problem.INVALID_CHARACTER, EnrollmentKey.problem("k7?fm2xp"))
        assertNull(EnrollmentKey.canonical("k7?fm2xp"))
        assertNull(EnrollmentKey.canonical("K7UF-M2XP"))
        assertEquals("K7QF-M2XP9", EnrollmentKey.format("k7qfm2xp9").text)
        assertEquals(EnrollmentKey.Problem.TOO_LONG, EnrollmentKey.problem("K7QF-M2XP9"))
        assertNull(EnrollmentKey.canonical("K7QF-M2XP9"))
    }

    @Test fun `empty incomplete and valid keys are distinguished`() {
        assertEquals(EnrollmentKey.Problem.EMPTY, EnrollmentKey.problem(" \t- "))
        assertEquals(EnrollmentKey.Problem.INCOMPLETE, EnrollmentKey.problem("K7QF-M2X"))
        assertNull(EnrollmentKey.problem("K7QF-M2XP"))
        assertEquals("0000-0000", EnrollmentKey.canonical("00000000"))
        assertEquals("ZZZZ-ZZZZ", EnrollmentKey.canonical("zzzzzzzz"))
    }

    @Test fun `caret positions and a selected range survive formatting in the middle`() {
        assertEquals(EnrollmentKey.Edit("K7QF-M2XP", 3, 3), EnrollmentKey.format("k7qfm2xp", 3))
        assertEquals(EnrollmentKey.Edit("K7QF-M2XP", 4, 4), EnrollmentKey.format("K7QF-M2XP", 4))
        assertEquals(EnrollmentKey.Edit("K7QF-M2XP", 5, 5), EnrollmentKey.format("K7QF-M2XP", 5))
        assertEquals(EnrollmentKey.Edit("K7QF-M2XP", 2, 7), EnrollmentKey.format("k7qfm2xp", 2, 6))
    }

    @Test fun `backspace after the generated dash removes the previous key character`() {
        val change = EnrollmentKey.Change("K7QF-M2XP", 4, 1, 0, 5, 5)
        assertEquals(EnrollmentKey.Edit("K7QM-2XP", 3, 3), EnrollmentKey.format("K7QFM2XP", 4, change = change))
    }

    @Test fun `forward delete before the generated dash removes the next key character`() {
        val change = EnrollmentKey.Change("K7QF-M2XP", 4, 1, 0, 4, 4)
        assertEquals(EnrollmentKey.Edit("K7QF-2XP", 4, 4), EnrollmentKey.format("K7QFM2XP", 4, change = change))
    }

    @Test fun `backspacing through a short code does not trap the user at the separator`() {
        var text = "K7QF-M2XP"
        var caret = text.length
        for (remaining in 7 downTo 0) {
            val before = text
            val raw = text.removeRange(caret - 1, caret)
            val change = EnrollmentKey.Change(before, caret - 1, 1, 0, caret, caret)
            val edit = EnrollmentKey.format(raw, caret - 1, change = change)
            text = edit.text
            caret = edit.selectionStart
            assertEquals(remaining, EnrollmentKey.compact(text).length)
            assertEquals(text.length, caret)
        }
        assertEquals("", text)
    }

    @Test fun `selecting a separator does not delete an unselected key character`() {
        val change = EnrollmentKey.Change("K7QF-M2XP", 4, 1, 0, 4, 5)
        assertEquals("K7QF-M2XP", EnrollmentKey.format("K7QFM2XP", 4, change = change).text)
    }

    @Test fun `replacement paste keeps the insertion point rather than jumping to the end`() {
        val change = EnrollmentKey.Change("K7QF-M2XP", 2, 4, 2, 2, 6)
        assertEquals(EnrollmentKey.Edit("K7AB-2XP", 4, 4), EnrollmentKey.format("K7ab2XP", 4, change = change))
    }

    @Test fun `formatting and canonicalization are idempotent for valid keys`() {
        for (key in listOf("K7QF-M2XP", "1234-5678", "ABCD-EFGH", "VWXY-Z012")) {
            assertEquals(key, EnrollmentKey.format(key).text)
            assertEquals(key, EnrollmentKey.canonical(EnrollmentKey.format(key).text))
        }
    }
}
