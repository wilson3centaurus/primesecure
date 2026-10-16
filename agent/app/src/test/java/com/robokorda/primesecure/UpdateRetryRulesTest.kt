package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Test

class UpdateRetryRulesTest {
    @Test fun retriesAtFiveMinutesWithoutHammeringServer() {
        assertFalse(UpdateRetryRules.due(22,22,1000,300999))
        assertTrue(UpdateRetryRules.due(22,22,1000,301000))
    }
    @Test fun newerReleaseDoesNotInheritFailedBuildDelay() {
        assertTrue(UpdateRetryRules.due(23,22,1000,1001))
    }
    @Test fun clockCorrectionCannotLeaveDeviceStuck() {
        assertTrue(UpdateRetryRules.due(22,22,1000,999))
    }
}
