package com.robokorda.primesecure

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Student content stays app-private; hiding changes presentation, never deletes files. */
class HubStore(private val context: Context) {
    private val prefs = context.getSharedPreferences("student-hub", Context.MODE_PRIVATE)
    init {
      synchronized(bindingLock) {
        val device = AgentStore(context).deviceId
        if (prefs.getString("device", null) != device) {
            prefs.edit().clear().putString("device", device).commit()
            // These are only our own downloaded school files, never user documents.
            File(context.filesDir, "school-notes").listFiles()?.forEach { it.delete() }
            context.filesDir.listFiles()?.filter { it.name.startsWith("message-image-") }?.forEach { it.delete() }
            context.filesDir.listFiles()?.filter { it.name.startsWith("hub-preview-") }?.forEach { it.delete() }
            File(context.filesDir,"file-inventory.json").delete()
        }
      }
    }
    var catalog: JSONObject
        get() = JSONObject(prefs.getString("catalog", "{}")!!)
        set(value) { prefs.edit().putString("catalog", value.toString()).commit() }
    var syncError: String?
        get() = prefs.getString("sync_error", null)
        set(value) { prefs.edit().putString("sync_error", value).apply() }
    var profileDraft: JSONObject?
        get() = prefs.getString("profile_draft", null)?.let(::JSONObject)
        set(value) { prefs.edit().putString("profile_draft", value?.toString()).commit() }
    var localWallpaper: String?
        get() = prefs.getString("local_wallpaper", null)
        set(value) { prefs.edit().putString("local_wallpaper", value).commit() }
    fun hidden(key: String) = prefs.getBoolean("hidden:$key", false)
    fun hiddenKeys() = prefs.all.keys.filter { it.startsWith("hidden:") && prefs.getBoolean(it,false) }.map { it.removePrefix("hidden:") }
    fun hide(key: String, value: Boolean) { prefs.edit().putBoolean("hidden:$key", value).commit() }
    fun saveMessage(id: String, payload: JSONObject, created: String) {
        if (message(id) != null) return
        prefs.edit().putString("message:$id", JSONObject().put("id", id).put("payload", payload)
            .put("created_at", created).toString()).commit()
    }
    fun message(id: String): JSONObject? = prefs.getString("message:$id", null)?.let(::JSONObject)
    fun messages(): List<JSONObject> = prefs.all.keys.filter { it.startsWith("message:") }
        .mapNotNull { message(it.removePrefix("message:")) }.sortedByDescending { it.optString("created_at") }
    fun acknowledge(id: String, synced: Boolean = false) {
        val message = message(id) ?: return
        message.put("acknowledged", true).put("ack_synced", synced)
        prefs.edit().putString("message:$id", message.toString()).commit()
    }
    fun pending(): JSONObject? = messages().lastOrNull {
        it.optJSONObject("payload")?.optBoolean("require_ack", false) == true && !it.optBoolean("acknowledged")
    }
    fun seen(id:String,synced:Boolean=false) {
        val message=message(id) ?: return
        message.put("seen",true).put("seen_synced",synced)
        prefs.edit().putString("message:$id",message.toString()).commit()
    }
    fun resourceFile(item: JSONObject): File {
        val id = java.util.UUID.fromString(item.getString("id")).toString()
        val ext = item.optString("storage_path").substringAfterLast('.', "bin")
            .takeIf { it.matches(Regex("[a-zA-Z0-9]{1,10}")) } ?: "bin"
        return File(File(context.filesDir, "school-notes").apply { mkdirs() }, "$id.$ext")
    }
    fun items(): List<JSONObject> {
        val array = catalog.optJSONArray("items") ?: JSONArray()
        return (0 until array.length()).map { array.getJSONObject(it) }
    }
    companion object { private val bindingLock = Any() }
}
