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
    @Test fun eachRequiredStageMustComplete() {
        for (missing in 0..7) {
            val flags = BooleanArray(8) { it != missing }
            assertFalse("stage $missing", SetupRequirements.ready(flags[0],flags[1],flags[2],flags[3],flags[4],flags[5],flags[6],flags[7]))
        }
        assertTrue(SetupRequirements.ready(true,true,true,true,true,true,true,true))
    }
    @Test fun emptyLibrariesStillRequireManagementPolicyAndCatalogue() {
        assertFalse(SetupRequirements.ready(true,true,false,false,true,true,true,true))
    }
}
