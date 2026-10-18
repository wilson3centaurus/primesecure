package com.robokorda.primesecure

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Student content stays app-private; hiding changes presentation, never deletes files. */
class HubStore(private val context: Context) {
    private val prefs = context.getSharedPreferences("student-hub", Context.MODE_PRIVATE)
    private val boundDevice = AgentStore(context).deviceId
    private val boundEnrollment = enrollmentBinding()
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
        if(prefs.getString("selection_binding",null)!=boundEnrollment) {
            prefs.edit().remove("favorites").remove("pinned_keys").putString("selection_binding",boundEnrollment).commit()
        }
      }
    }
    var catalog: JSONObject
        get() = JSONObject(prefs.getString("catalog", "{}")!!)
        set(value) { synchronized(bindingLock) {
            val previous=JSONObject(prefs.getString("catalog","{}")!!)
            if(value.optLong("_sync_revision",-1)>=previous.optLong("_sync_revision",-1)) {
                val edit=prefs.edit().putString("catalog", value.toString())
                if(previous.optString("student_id")!=value.optString("student_id")) {
                    edit.remove("favorites").remove("pinned_keys")
                }
                edit.commit()
            }
        } }
    var managementSync:JSONObject
        get()=JSONObject(prefs.getString("management_sync","{}")!!)
        set(value) { prefs.edit().putString("management_sync",value.toString()).commit() }
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
    /** References only: no school file is copied, moved or removed by these preferences. */
    fun favoriteKeys(): List<String> = preferenceKeys("favorites")
    fun pinnedKeys(): List<String> = preferenceKeys("pinned_keys")
    fun favorite(key: String, value: Boolean, student: String = catalog.stringOrNull("student_id") ?: "") = setPreferenceKey("favorites",key,value,student)
    fun pin(key: String, value: Boolean, student: String = catalog.stringOrNull("student_id") ?: "") = setPreferenceKey("pinned_keys",key,value,student)
    private fun preferenceKeys(name: String): List<String> = synchronized(bindingLock) {
        if(!AgentStore(context).isEnrolled || boundDevice==null || AgentStore(context).deviceId!=boundDevice || enrollmentBinding()!=boundEnrollment || prefs.getString("device",null)!=boundDevice) return@synchronized emptyList()
        val keys=runCatching { JSONArray(prefs.getString(name,"[]")) }.getOrElse { JSONArray() }
        (0 until keys.length()).map { keys.optString(it) }.filter { it.isNotBlank() }.distinct()
    }
    private fun setPreferenceKey(name: String,key: String,value: Boolean,student: String) = synchronized(bindingLock) {
        check(boundDevice!=null && AgentStore(context).isEnrolled && AgentStore(context).deviceId==boundDevice && enrollmentBinding()==boundEnrollment && prefs.getString("device",null)==boundDevice) { "This enrollment has changed. Reopen your workspace." }
        check((catalog.stringOrNull("student_id") ?: "")==student) { "The assigned student has changed. Reopen your workspace." }
        require(key.length in 1..4096 && (key.startsWith("item:") || key.startsWith("media:") || key.startsWith("folder:"))) { "Invalid library reference." }
        val keys=preferenceKeys(name).toMutableSet()
        if(value) { check(keys.size<20000 || key in keys) { "Your saved list is full. Remove an older favorite first." };keys.add(key) } else keys.remove(key)
        check(prefs.edit().putString(name,JSONArray(keys.toList()).toString()).commit()) { "Could not save your library preference. Try again." }
    }
    private fun enrollmentBinding(): String {
        val store=AgentStore(context)
        return java.security.MessageDigest.getInstance("SHA-256").digest(listOf(store.deviceId,store.email,store.password).joinToString("\u0000").toByteArray()).joinToString("") { "%02x".format(it) }
    }
    fun saveMessage(id: String, payload: JSONObject, created: String) {
        if (message(id) != null) return
        prefs.edit().putString("message:$id", JSONObject().put("id", id).put("payload", payload)
            .put("created_at", created).toString()).commit()
    }
    fun removeMessages(ids: Set<String>) {
        val edit=prefs.edit();ids.forEach { edit.remove("message:$it") };edit.commit()
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
