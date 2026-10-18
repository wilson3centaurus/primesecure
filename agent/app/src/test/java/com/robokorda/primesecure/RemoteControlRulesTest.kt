package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Test

class RemoteControlRulesTest {
    @Test fun alarmHasHardBounds() {
        assertEquals(5,RemoteControlRules.alarmSeconds(5))
        assertEquals(30,RemoteControlRules.alarmSeconds(30))
        for(seconds in listOf(-1,0,4,31,3600)) {
            try { RemoteControlRules.alarmSeconds(seconds);fail("Accepted $seconds") }
            catch(_:IllegalArgumentException) { }
        }
    }
    @Test fun expiredOrFarFutureRequestNeverRuns() {
        assertFalse(RemoteControlRules.validWindow(1000,1000,120000))
        assertFalse(RemoteControlRules.validWindow(1000,999,120000))
        assertFalse(RemoteControlRules.validWindow(1000,121001,120000))
        assertTrue(RemoteControlRules.validWindow(1000,121000,120000))
    }
    @Test fun privatePreviewReferencesAreUuidsNotPaths() {
        assertTrue(RemoteControlRules.validId("12345678-1234-1234-1234-123456789012"))
        for(value in listOf("../photo","/tmp/a","","1234","12345678-1234-1234-1234-12345678901z")) assertFalse(RemoteControlRules.validId(value))
    }
}
