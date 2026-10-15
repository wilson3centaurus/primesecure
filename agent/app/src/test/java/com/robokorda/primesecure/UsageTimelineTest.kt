package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Test

class UsageTimelineTest {
    @Test fun appSwitchesAndDuplicateActivityResumeNeverDoubleCount() {
        val totals=UsageTimeline.totals(0,100,listOf(
            ForegroundEvent(10,"notes",true),ForegroundEvent(15,"notes",true),
            ForegroundEvent(30,"calculator",true),ForegroundEvent(40,"notes",false),
            ForegroundEvent(60,"calculator",false)))
        assertEquals(mapOf("notes" to 20L,"calculator" to 30L),totals)
    }
    @Test fun activeTailIsClippedAndUnobservedBeginningIsNotFabricated() {
        assertEquals(mapOf("notes" to 70L),UsageTimeline.totals(0,100,listOf(
            ForegroundEvent(-10,"browser",true),ForegroundEvent(20,"browser",false),ForegroundEvent(30,"notes",true),ForegroundEvent(120,"notes",false))))
    }
    @Test fun shutdownsAndLongSamplingGapsDoNotBecomeInternetOrScreenTime() {
        assertEquals(30_000L,UsageTimeline.observedDelta(60_000,30_000))
        assertEquals(0L,UsageTimeline.observedDelta(3_600_000,30_000))
        assertEquals(0L,UsageTimeline.observedDelta(1_000,30_000))
        assertEquals(0L,UsageTimeline.observedDelta(30_000,0))
    }
    @Test fun screenOffOrShutdownClosesTheForegroundTailWithoutAnActivityPause() {
        assertEquals(mapOf("notes" to 20L),UsageTimeline.totals(0,100,listOf(
            ForegroundEvent(10,"notes",true),ForegroundEvent(30,"",false))))
    }
}
