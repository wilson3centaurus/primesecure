package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Test

class PhoneNumbersTest {
    @Test fun normalizesZimbabweMobileNumbers() {
        assertEquals("+263771234567",PhoneNumbers.zimbabwe("077 123 4567"))
        assertEquals("+263771234567",PhoneNumbers.zimbabwe("263771234567"))
        assertEquals("+263771234567",PhoneNumbers.zimbabwe("+263 (77) 123-4567"))
    }
    @Test fun rejectsIncompleteOrUnscopedNumbers() {
        assertNull(PhoneNumbers.zimbabwe("77123"))
        assertNull(PhoneNumbers.zimbabwe("hello"))
    }
}
