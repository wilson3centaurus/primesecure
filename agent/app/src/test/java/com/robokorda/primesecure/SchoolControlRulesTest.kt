package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Test

class SchoolControlRulesTest {
    @Test fun locationCadenceBoundsNormalReadsAndSeparatesLostMode() {
        assertEquals(30*60_000L,SchoolControlRules.locationIntervalMs(30,false))
        assertEquals(5*60_000L,SchoolControlRules.locationIntervalMs(0,false))
        assertEquals(1440*60_000L,SchoolControlRules.locationIntervalMs(Int.MAX_VALUE,false))
        assertEquals(2*60_000L,SchoolControlRules.locationIntervalMs(30,true))
        assertFalse(SchoolControlRules.due(2_000,1_000,5_000))
        assertTrue(SchoolControlRules.due(1_000,2_000,5_000)) // Clock correction must not stop future reporting.
    }
    @Test fun primeIdNeverInventsAHardwareMac() {
        assertNull(SchoolControlRules.inventoryMac("02:00:00:00:00:00"))
        assertNull(SchoolControlRules.inventoryMac("not-a-prime-id"))
        assertNull(SchoolControlRules.inventoryMac(null))
        assertEquals("78:C8:24:B5:8E:12",SchoolControlRules.inventoryMac("78:c8:24:b5:8e:12"))
    }
    @Test fun defaultSystemAndAgentAppsCannotBeStudentRemoved() {
        assertTrue(SchoolControlRules.studentMayRemove(false,false,false))
        assertFalse(SchoolControlRules.studentMayRemove(true,false,false))
        assertFalse(SchoolControlRules.studentMayRemove(false,true,false))
        assertFalse(SchoolControlRules.studentMayRemove(false,false,true))
    }
}
