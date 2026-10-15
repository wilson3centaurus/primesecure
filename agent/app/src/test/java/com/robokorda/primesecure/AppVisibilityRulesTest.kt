package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Test

class AppVisibilityRulesTest {
    private val essential = setOf("system.login", "system.settings", "launcher.one", "launcher.two", "keyboard", "webview", "agent")

    @Test fun strictCatalogueNeverHidesFirmwareOrLoginDependencies() {
        val hidden = AppVisibilityRules.hiddenPackages(essential, setOf("approved"),
            essential + setOf("approved", "unapproved"), emptySet(), essential, true)
        assertEquals(setOf("unapproved"), hidden)
    }

    @Test fun emptyCatalogueStillPreservesEssentialApps() {
        assertEquals(setOf("game"), AppVisibilityRules.hiddenPackages(emptySet(), emptySet(),
            essential + "game", emptySet(), essential, true))
    }

    @Test fun previouslyHiddenLoginAppIsRemovedFromRestrictions() {
        assertEquals(setOf("game"), AppVisibilityRules.hiddenPackages(emptySet(), emptySet(),
            emptySet(), setOf("system.login", "game"), essential, true))
    }

    @Test fun disablingStrictRuleReleasesPreviouslyRestrictedApps() {
        assertTrue(AppVisibilityRules.hiddenPackages(emptySet(), emptySet(), setOf("game"),
            setOf("game"), essential, false).isEmpty())
    }

    @Test fun explicitThirdPartyBlocksRemainAndApprovedAppsAreVisible() {
        assertEquals(setOf("blocked"), AppVisibilityRules.hiddenPackages(setOf("blocked"),
            setOf("approved"), setOf("approved"), setOf("approved"), essential, false))
    }
}
