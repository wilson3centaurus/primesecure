package com.robokorda.primesecure

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/** School-opt-in aggregate usage, with an explicit Android Usage Access grant for app durations. */
object UsageReporter {
    private fun enabled(context: Context) = HubStore(context).catalog.optJSONObject("management")?.optBoolean("usage_reporting") == true
    private fun prefs(context: Context) = context.getSharedPreferences("school-usage", Context.MODE_PRIVATE).also {
        val device = AgentStore(context).deviceId
        if (it.getString("device", null) != device) it.edit().clear().putString("device", device).commit()
    }

    @Suppress("DEPRECATION")
    fun accessGranted(context: Context): Boolean = runCatching {
        context.getSystemService(AppOpsManager::class.java)
            .checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName) == AppOpsManager.MODE_ALLOWED
    }.getOrDefault(false)

    fun openAccessSettings(context: Context) {
        // This special access cannot be granted using runtime Device Owner permission APIs.
        val intent=Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS,android.net.Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if(intent.resolveActivity(context.packageManager)!=null)context.startActivity(intent)
        else context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    fun status(context: Context): JSONObject = JSONObject().put("enabled", enabled(context)).put("usage_access", accessGranted(context))
        .put("disclosure", "When enabled by your school, PrimeSecure reports app names and foreground time, observed screen time, connected time and observed device uptime. It does not record screen content, typed text, browsing history, camera or microphone.")
        .put("coverage", "Observed while the management service runs; gaps and shutdown periods are not counted. App time additionally requires Android Usage Access.")

    @Synchronized
    fun sample(context: Context) {
        val prefs = prefs(context)
        if (!enabled(context)) {
            if (prefs.all.keys.any { it != "device" }) prefs.edit().clear().putString("device", AgentStore(context).deviceId).apply()
            return
        }
        val now = System.currentTimeMillis()
        val elapsed = SystemClock.elapsedRealtime()
        val day = Instant.ofEpochMilli(now).atZone(ZoneOffset.UTC).toLocalDate().toString()
        val priorDay = prefs.getString("sample_day", null)
        val delta = UsageTimeline.observedDelta(elapsed, prefs.getLong("sample_elapsed", 0))
            .coerceAtMost(now - LocalDate.parse(day).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        val amount = if (priorDay == day) delta else 0L
        val row = prefs.getString("day:$day", null)?.let(::JSONObject) ?: JSONObject().put("day", day)
        row.put("uptime_ms", (row.optLong("uptime_ms") + amount).coerceAtMost(DAY_MS))
        row.put("screen_ms", (row.optLong("screen_ms") + if (context.getSystemService(PowerManager::class.java).isInteractive) amount else 0).coerceAtMost(DAY_MS))
        row.put("online_ms", (row.optLong("online_ms") + if (Connectivity.online(context)) amount else 0).coerceAtMost(DAY_MS))
        val editor = prefs.edit().putString("day:$day", row.toString()).putString("sample_day", day).putLong("sample_elapsed", elapsed)
        prefs.all.keys.filter { it.startsWith("day:") }.sortedDescending().drop(7).forEach { editor.remove(it) }
        editor.apply()
    }

    suspend fun report(context: Context) {
        if (!enabled(context)) return
        sample(context)
        val prefs = prefs(context)
        val now = System.currentTimeMillis()
        if (!SchoolControlRules.due(now, prefs.getLong("reported", 0), 15 * 60_000L)) return
        val device = AgentStore(context).deviceId
        val allowed = accessGranted(context)
        for (key in prefs.all.keys.filter { it.startsWith("day:") }.sorted()) {
            if (AgentStore(context).deviceId != device || !enabled(context)) return
            val payload = prefs.getString(key, null)?.let(::JSONObject) ?: continue
            val day = payload.getString("day")
            val start = LocalDate.parse(day).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
            val end = minOf(start + DAY_MS, now)
            val (apps, complete) = if (allowed) appDurations(context, start, end) else JSONArray() to false
            payload.put("apps", apps).put("usage_access", allowed)
                .put("coverage", if (!allowed) "Observed service uptime/screen/network only; Android Usage Access not granted."
                    else if (!complete) "App event query was capped; durations are partial. Service samples have up to 30-second resolution."
                    else "App foreground activity events in this UTC day; an activity spanning midnight may be undercounted. Service samples have up to 30-second resolution and exclude gaps.")
            SupabaseApi(AgentStore(context)).rpc("device_report_usage", JSONObject().put("p_payload", payload))
            if (end == start + DAY_MS) prefs.edit().remove(key).apply()
        }
        prefs.edit().putLong("reported", now).apply()
    }

    @Suppress("DEPRECATION")
    private fun appDurations(context: Context, start: Long, end: Long): Pair<JSONArray, Boolean> {
        val source = context.getSystemService(UsageStatsManager::class.java).queryEvents(start, end) ?: return JSONArray() to false
        val events = mutableListOf<ForegroundEvent>()
        val event = UsageEvents.Event()
        var read = 0
        while (source.hasNextEvent() && read++ < 100_000) {
            source.getNextEvent(event)
            if ((android.os.Build.VERSION.SDK_INT >= 28 && event.eventType == UsageEvents.Event.SCREEN_NON_INTERACTIVE) ||
                (android.os.Build.VERSION.SDK_INT >= 29 && event.eventType == UsageEvents.Event.DEVICE_SHUTDOWN)) {
                events += ForegroundEvent(event.timeStamp,"",false)
            }
            if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND || event.eventType == UsageEvents.Event.MOVE_TO_BACKGROUND) {
                events += ForegroundEvent(event.timeStamp, event.packageName.orEmpty(), event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND)
            }
        }
        val totals = UsageTimeline.totals(start, end, events)
        val apps = JSONArray(totals.entries.sortedByDescending { it.value }.take(100).map { (pkg, time) ->
            val label = runCatching { context.packageManager.getApplicationInfo(pkg, 0).loadLabel(context.packageManager).toString() }.getOrDefault(pkg)
            JSONObject().put("package", pkg).put("label", label.take(160)).put("foreground_ms", time)
        })
        return apps to (!source.hasNextEvent() && totals.size <= 100)
    }

    private const val DAY_MS = 86_400_000L
}
