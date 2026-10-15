package com.robokorda.primesecure

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Durable local presentation of the server's requested/applied configuration revision. */
internal object SettingsSync {
    private val lock=Any()
    fun pending(c:Context)=HubStore(c).managementSync.let { it.optLong("revision")>it.optLong("applied_revision") }
    fun observe(c:Context,remote:JSONObject):Boolean = synchronized(lock) {
        val hub=HubStore(c);val old=hub.managementSync
        val revision=remote.optLong("revision")
        if(revision<old.optLong("revision"))return@synchronized pending(c)
        val applied=maxOf(old.optLong("applied_revision"),remote.optLong("applied_revision"))
        val changed=revision>old.optLong("revision")
        val phase=if(revision>applied) if(changed)"queued" else old.optString("phase","queued") else "applied"
        val updated=if(changed || applied!=old.optLong("applied_revision") || phase!=old.optString("phase"))System.currentTimeMillis() else old.optLong("updated_at")
        val next=JSONObject(remote.toString()).put("applied_revision",applied)
            .put("phase",phase).put("updated_at",updated)
        hub.managementSync=next
        if(changed && revision>applied) {
            DeviceLog.event(c,"info","policy","school_changes_received")
            Notifications.schoolSync(c,"New school updates",description(next)+". Applying settings; downloads continue in Background tasks.")
        }
        revision>applied
    }
    fun phase(c:Context,value:String) = synchronized(lock) {
        val hub=HubStore(c);val state=hub.managementSync
        if(state.optLong("revision")>state.optLong("applied_revision"))
            hub.managementSync=state.put("phase",value).put("updated_at",System.currentTimeMillis())
    }
    fun snapshot(c:Context):JSONObject = HubStore(c).managementSync.apply {
        if(optLong("revision")>optLong("applied_revision") && !Connectivity.online(c))put("phase","waiting")
    }
    fun description(state:JSONObject):String {
        val names=state.optJSONArray("topics") ?: JSONArray()
        return (0 until names.length()).map { when(names.optString(it)) {
            "apps"->"Apps";"notes"->"School notes";"wallpapers"->"Wallpapers";"library"->"School library";else->"Settings"
        } }.distinct().joinToString(", ").ifBlank { "School settings" }
    }
}
