package com.robokorda.primesecure

import android.content.Context
import java.util.concurrent.TimeUnit

/**
 * Fixed, read-only system-log digest for fleet troubleshooting without ADB.
 *
 * Reads recent logcat (READ_LOGS is granted to this privileged app), keeps only
 * lines matching a fixed list of crash/licence/launcher/owner patterns compiled
 * into the APK, and queues them as bounded diagnostic events. The server cannot
 * change the command, the filter or the buffers: there is no remote shell here.
 */
internal object SystemLogDigest {
    private val PATTERNS = listOf(
        "FATAL EXCEPTION", " E AndroidRuntime", "AndroidRuntime: Process:", "ANR in ",
        "has died", "Force finishing", "Licen", "licen", "launcher3", "Launcher3",
        "RoboKordaOwner", "PrimeSecure", "SetupGate",
    )
    private const val MAX_LINE = 300
    private const val MAX_EVENTS_PER_RUN = 3
    private const val EVENT_BUDGET = 4300

    fun collect(context: Context) = runCatching {
        val prefs = context.createDeviceProtectedStorageContext().getSharedPreferences("system-log-digest", Context.MODE_PRIVATE)
        val since = prefs.getString("last_stamp", "") ?: ""
        val process = ProcessBuilder("/system/bin/logcat", "-d", "-v", "threadtime", "-b", "main,system,crash", "-t", "4000")
            .redirectErrorStream(true).start()
        val raw = process.inputStream.bufferedReader().use { it.readText() }
        if (!process.waitFor(10, TimeUnit.SECONDS)) process.destroyForcibly()
        // threadtime lines start "MM-DD HH:MM:SS.mmm"; string order matches time order within a year.
        val fresh = raw.lineSequence()
            .filter { it.length > 18 && it[2] == '-' && it.substring(0, 18) > since }
            .filter { line -> PATTERNS.any(line::contains) }
            .map { it.take(MAX_LINE) }
            .toList()
        if (fresh.isEmpty()) return@runCatching
        val chunks = mutableListOf<MutableList<String>>(mutableListOf())
        var size = 0
        for (line in fresh.takeLast(60)) {
            if (size + line.length + 4 > EVENT_BUDGET) { chunks += mutableListOf<String>(); size = 0 }
            chunks.last() += line; size += line.length + 4
        }
        chunks.takeLast(MAX_EVENTS_PER_RUN).forEachIndexed { i, lines ->
            DeviceLog.recordDigest(context, "logcat_digest_${i + 1}_of_${minOf(chunks.size, MAX_EVENTS_PER_RUN)}", lines)
        }
        prefs.edit().putString("last_stamp", fresh.last().substring(0, 18)).commit()
    }.let { Unit }
}
