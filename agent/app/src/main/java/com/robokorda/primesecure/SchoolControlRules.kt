package com.robokorda.primesecure

/** Pure decisions shared by reporting and the Android enforcement boundary. */
internal object SchoolControlRules {
    fun locationIntervalMs(minutes: Int, lost: Boolean): Long =
        (if (lost) 2 else minutes.coerceIn(5, 1440)) * 60_000L

    fun due(now: Long, last: Long, interval: Long): Boolean =
        last <= 0 || now < last || now - last >= interval

    fun inventoryMac(value: String?): String? = value?.trim()?.uppercase()?.takeIf {
        it.matches(Regex("(?:[0-9A-F]{2}:){5}[0-9A-F]{2}")) &&
            it !in setOf("02:00:00:00:00:00", "00:00:00:00:00:00", "FF:FF:FF:FF:FF:FF")
    }

    fun studentMayRemove(own: Boolean, required: Boolean, system: Boolean): Boolean = !own && !required && !system
}
