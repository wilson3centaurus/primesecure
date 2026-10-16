package com.robokorda.primesecure

import android.os.UserManager

/** Individual supported restrictions; never disable Settings, keyguard or a launcher. */
internal object SettingsLockdownRules {
    private val general=mapOf(
        UserManager.DISALLOW_MODIFY_ACCOUNTS to 18,
        UserManager.DISALLOW_CONFIG_CREDENTIALS to 18,
        UserManager.DISALLOW_APPS_CONTROL to 18,
        UserManager.DISALLOW_SAFE_BOOT to 23,
        UserManager.DISALLOW_CONFIG_VPN to 21,
        UserManager.DISALLOW_CONFIG_TETHERING to 21,
        UserManager.DISALLOW_NETWORK_RESET to 23,
        UserManager.DISALLOW_CONFIG_DATE_TIME to 28,
        UserManager.DISALLOW_CONFIG_LOCATION to 28,
        UserManager.DISALLOW_AIRPLANE_MODE to 28,
        UserManager.DISALLOW_CONFIG_PRIVATE_DNS to 29,
        UserManager.DISALLOW_ADD_MANAGED_PROFILE to 26,
    )
    fun plan(settings:Boolean,debugging:Boolean,network:Boolean,paused:Boolean,sdk:Int):Map<String,Boolean> =
        general.filterValues { it<=sdk }.mapValues { settings&&!paused } + mapOf(
            UserManager.DISALLOW_DEBUGGING_FEATURES to (debugging&&!paused),
            UserManager.DISALLOW_CONFIG_WIFI to (network&&!paused),
            UserManager.DISALLOW_CONFIG_MOBILE_NETWORKS to (network&&!paused)
        )
}
