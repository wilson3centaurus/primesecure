package com.robokorda.primesecure

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Durable, per-enrollment outbox and download progress. Sensitive payloads never enter the WebView task list. */
class HubTasks(private val context: Context) {
    private val prefs = context.getSharedPreferences("hub-tasks", Context.MODE_PRIVATE)
    init { synchronized(lock) {
        val device = AgentStore(context).deviceId
        if (prefs.getString("device", null) != device) prefs.edit().clear().putString("device", device).commit()
    } }
    fun all(): List<JSONObject> = synchronized(lock) {
        prefs.all.keys.filter { it.startsWith("task:") }.mapNotNull { prefs.getString(it, null)?.let(::JSONObject) }.sortedByDescending { it.optLong("created") }
    }
    fun publicList(): JSONArray = JSONArray(all().take(150).map { JSONObject(it.toString()).apply { remove("payload") } })
    fun pending() = all().filter { it.optString("status") !in setOf("done", "installed", "removed", "failed", "superseded") }.sortedBy { it.optLong("created") }
    fun enqueue(action: String, payload: JSONObject, title: String, key: String? = null): String = synchronized(lock) {
        if (key != null) all().firstOrNull { it.optString("key") == key && it.optString("status") !in setOf("done", "installed", "removed", "failed", "superseded") }?.let { return@synchronized it.getString("id") }
        // Save a newer profile or wallpaper choice without allowing an older one to overwrite it later.
        if (action in setOf("profile", "wallpaper")) pending().filter { it.optString("action") == action }.forEach { update(it.getString("id"), "superseded") }
        val id = UUID.randomUUID().toString()
        save(JSONObject().put("id", id).put("action", action).put("payload", payload).put("title", title)
            .put("item_id",payload.optString("item_id",payload.optString("hub_item_id")))
            .put("key", key ?: "").put("created", System.currentTimeMillis()).put("status", "queued").put("bytes", 0).put("total", 0).put("speed", 0))
        // Completed progress history is bounded; never trim unsent work.
        all().filter { it.optString("status") in setOf("done", "installed", "removed", "superseded") }.drop(100).forEach { prefs.edit().remove("task:${it.getString("id")}").commit() }
        id
    }
    fun download(id: String, title: String, total: Long): String = synchronized(lock) {
        val key = "download:$id"
        val prior = all().firstOrNull { it.optString("key") == key }
        if (prior != null) { update(prior.getString("id"), "queued", total = total); prior.getString("id") }
        else enqueue("download", JSONObject().put("item_id", id), title, key)
    }
    fun update(id: String, status: String, bytes: Long? = null, total: Long? = null, speed: Long = 0, error: String? = null) = synchronized(lock) {
        val task = prefs.getString("task:$id", null)?.let(::JSONObject) ?: return@synchronized
        task.put("status", status).put("speed", speed).put("updated", System.currentTimeMillis())
        if (bytes != null) task.put("bytes", bytes)
        if (total != null) task.put("total", total)
        task.put("error", error ?: JSONObject.NULL)
        save(task)
        if(status=="failed" && task.optString("action") in setOf("install","download","admin_command"))
            DeviceLog.event(context,"error",if(task.optString("action")=="install")"install" else "download","background_task_failed")
    }
    fun retry(id: String) { if (all().any { it.optString("id") == id && it.optString("status") == "failed" }) update(id, "queued") }
    private fun save(task: JSONObject) { check(prefs.edit().putString("task:${task.getString("id")}", task.toString()).commit()) { "Could not save background task" } }
    companion object { private val lock = Any() }
}
