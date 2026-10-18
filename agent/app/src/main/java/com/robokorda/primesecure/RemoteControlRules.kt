package com.robokorda.primesecure

/** Pure limits; Android and server independently enforce these boundaries. */
internal object RemoteControlRules {
    const val MAX_ALARM_SECONDS = 30
    const val MAX_CAPTURE_BYTES = 260_000
    fun alarmSeconds(value: Int): Int {
        require(value in 5..MAX_ALARM_SECONDS) { "Alarm duration must be 5 to 30 seconds" }
        return value
    }
    fun validWindow(now: Long, expiry: Long, maxFutureMs: Long): Boolean =
        expiry > now && expiry - now <= maxFutureMs
    fun validId(value: String): Boolean = value.matches(Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"))
}
