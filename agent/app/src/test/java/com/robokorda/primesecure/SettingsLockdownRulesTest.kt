package com.robokorda.primesecure
import org.junit.Assert.*
import org.junit.Test
class SettingsLockdownRulesTest {
    @Test fun emergencyPauseReleasesAllNewRestrictions() {
        assertTrue(SettingsLockdownRules.plan(true,true,true,true,30).values.none { it })
    }
    @Test fun wifiAndDebuggingRemainIndependentForProvisioning() {
        val plan=SettingsLockdownRules.plan(true,false,false,false,30)
        assertTrue(plan.getValue("no_modify_accounts"))
        assertFalse(plan.getValue("no_config_wifi"));assertFalse(plan.getValue("no_debugging_features"))
        assertTrue(SettingsLockdownRules.plan(false,true,false,false,30).getValue("no_debugging_features"))
    }
    @Test fun olderAndroidDoesNotReceiveUnsupportedRestrictions() {
        val plan=SettingsLockdownRules.plan(true,true,true,false,26)
        assertFalse(plan.containsKey("no_config_private_dns"));assertFalse(plan.containsKey("no_config_date_time"))
        assertTrue(plan.getValue("no_safe_boot"))
    }
}
