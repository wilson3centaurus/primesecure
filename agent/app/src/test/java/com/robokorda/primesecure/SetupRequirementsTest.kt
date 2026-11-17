package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Test

class SetupRequirementsTest {
    @Test fun startupDoesNotWaitForAWholeVideoLibrary() {
        val ids = SetupRequirements.starterResources(listOf(StarterResource("video", 500_000_000),
            StarterResource("notes", 200_000), StarterResource("paper", 400_000)))
        assertEquals(setOf("notes", "paper"), ids)
    }
    @Test fun initialResourcesAreDeterministicAndBounded() {
        val resources = (1..10).map { StarterResource("note-$it", 8L*1024*1024) }
        assertEquals(SetupRequirements.starterResources(resources), SetupRequirements.starterResources(resources.reversed()))
        assertEquals(3, SetupRequirements.starterResources(resources).size)
    }
    @Test fun missingOrInvalidSizesAreNotPretendedToBeReady() {
        assertTrue(SetupRequirements.starterResources(listOf(StarterResource("bad", -1))).isEmpty())
    }
    @Test fun onlyCoreSecurityStagesBlockDesktopRelease() {
        for (missing in 0..3) {
            val flags = BooleanArray(4) { it != missing }
            assertFalse("stage $missing", SetupRequirements.readyForDesktop(flags[0],flags[1],flags[2],flags[3]))
        }
        assertTrue(SetupRequirements.readyForDesktop(true,true,true,true))
    }
    @Test fun backgroundDownloadsDoNotBlockDesktopRelease() {
        assertTrue(SetupRequirements.readyForDesktop(true,true,true,true))
        assertFalse(SetupRequirements.backgroundComplete(false,false,false,false))
        assertTrue(SetupRequirements.backgroundComplete(true,true,true,true))
    }
    @Test fun emptyLibrariesStillRequireManagementPolicyAndCatalogue() {
        assertFalse(SetupRequirements.readyForDesktop(true,true,false,false))
    }
}
