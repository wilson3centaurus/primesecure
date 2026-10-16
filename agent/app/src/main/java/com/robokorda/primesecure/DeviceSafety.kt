package com.robokorda.primesecure

import android.content.Context
import android.os.UserManager
import org.json.JSONObject

/** Small direct-boot journal; no student documents, credentials or Wi-Fi passwords. */
object DeviceSafety {
    private fun prefs(context:Context)=context.createDeviceProtectedStorageContext().getSharedPreferences("device-safety",Context.MODE_PRIVATE)
    fun paused(context:Context)=prefs(context).getBoolean("safe_mode",false)
    fun updatesPaused(context:Context)=prefs(context).getBoolean("updates_paused",false)
    @Synchronized fun bind(context:Context,deviceId:String) {
        val p=prefs(context)
        if(p.getString("device",null)==deviceId)return
        restoreJournal(context)
        check(p.edit().clear().putString("device",deviceId).commit())
    }
    @Synchronized fun observe(context:Context,control:JSONObject?) {
        control ?: return
        val p=prefs(context);val revision=control.optLong("revision")
        if(revision<p.getLong("revision",0))return
        check(p.edit().putLong("revision",revision).putBoolean("safe_mode",control.optBoolean("safe_mode"))
            .putBoolean("updates_paused",control.optBoolean("updates_paused"))
            .putLong("rollback_requested",control.optLong("ui_rollback_revision")).commit())
        if(paused(context))restoreJournal(context)
        finishRollback(context)
    }
    @Synchronized fun finishRollback(context:Context) {
        if(!context.getSystemService(UserManager::class.java).isUserUnlocked)return
        val p=prefs(context);val request=p.getLong("rollback_requested",0)
        if(request<=p.getLong("rollback_applied",0))return
        StudentUiUpdates.reject(context)
        check(p.edit().putLong("rollback_applied",request).commit())
        DeviceLog.record(context,"info","safety","interface_rollback_applied")
    }
    fun journal(context:Context,hidden:Set<String>,suspended:Set<String>) {
        check(prefs(context).edit().putStringSet("hidden",hidden).putStringSet("suspended",suspended).commit()) {
            "Could not persist offline recovery journal"
        }
    }
    /** Never accesses credential-encrypted AgentStore or the network. */
    @Synchronized fun restoreJournal(context:Context) {
        if(!AdminReceiver.isDeviceOwner(context))return
        val dpm=AdminReceiver.dpm(context);val admin=AdminReceiver.component(context);val p=prefs(context)
        val failed=mutableSetOf<String>()
        for(pkg in p.getStringSet("hidden",emptySet())!!.toSet())runCatching {
            if(dpm.isApplicationHidden(admin,pkg))check(dpm.setApplicationHidden(admin,pkg,false))
        }.onFailure {failed+=pkg;DeviceLog.event(context,"warning","safety","offline_restore_failed",it,JSONObject().put("package",pkg))}
        for(pkg in p.getStringSet("suspended",emptySet())!!.toSet())runCatching {
            if(dpm.isPackageSuspended(admin,pkg))check(dpm.setPackagesSuspended(admin,arrayOf(pkg),false).isEmpty())
        }.onFailure {failed+=pkg;DeviceLog.event(context,"warning","safety","offline_restore_failed",it,JSONObject().put("package",pkg))}
        p.edit().putStringSet("restore_failures",failed).putLong("last_restore_at",System.currentTimeMillis()).commit()
    }
    fun status(context:Context)=JSONObject().put("safe_mode",paused(context)).put("updates_paused",updatesPaused(context))
        .put("revision",prefs(context).getLong("revision",0)).put("ui_rollback_applied",prefs(context).getLong("rollback_applied",0))
        .put("offline_boot_restore",true)
        .put("restore_failures",org.json.JSONArray(prefs(context).getStringSet("restore_failures",emptySet())!!.toList()))
        .put("last_restore_at",prefs(context).getLong("last_restore_at",0))
    fun clear(context:Context) { prefs(context).edit().clear().commit() }
}
