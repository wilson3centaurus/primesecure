package com.robokorda.primesecure

import android.content.Context
import android.os.Build
import org.json.JSONObject

object DeviceSettingsLockdown {
    private fun prefs(c:Context)=c.createDeviceProtectedStorageContext().getSharedPreferences("settings-lockdown",Context.MODE_PRIVATE)
    fun apply(context:Context,management:JSONObject):List<String> {
        val dpm=AdminReceiver.dpm(context);val admin=AdminReceiver.component(context);val p=prefs(context)
        val owned=p.getStringSet("owned",emptySet())!!.toMutableSet();val results=JSONObject();val problems=mutableListOf<String>()
        val plan=SettingsLockdownRules.plan(management.optBoolean("lock_device_settings"),management.optBoolean("block_debugging_features"),management.optBoolean("lock_network_settings"),DeviceSafety.paused(context),Build.VERSION.SDK_INT)
        for((key,on) in plan) {
            try {
                if(on) {
                    owned+=key;check(p.edit().putStringSet("owned",owned.toSet()).commit())
                    dpm.addUserRestriction(admin,key)
                } else if(key in owned) {
                    dpm.clearUserRestriction(admin,key);owned-=key
                    check(p.edit().putStringSet("owned",owned.toSet()).commit())
                }
                val actual=dpm.getUserRestrictions(admin).getBoolean(key)
                results.put(key,JSONObject().put("requested",on).put("applied",actual))
                if(on&&!actual)problems+="$key: Android did not confirm the restriction"
            } catch(e:Exception) {
                problems+="$key: ${e.javaClass.simpleName}"
                results.put(key,JSONObject().put("requested",on).put("error",e.javaClass.simpleName))
                DeviceLog.event(context,"warning","policy","settings_restriction_failed",e,JSONObject().put("restriction",key))
            }
        }
        check(p.edit().putString("results",results.toString()).commit())
        DeviceLog.state(context,"settings_lockdown","policy","settings_lockdown_applied",results)
        return problems
    }
    /** Only reverses restrictions journalled by this feature; works before unlock. */
    fun clear(context:Context) {
        if(!AdminReceiver.isDeviceOwner(context))return
        val p=prefs(context);val remaining=p.getStringSet("owned",emptySet())!!.toMutableSet()
        for(key in remaining.toSet())runCatching {
            AdminReceiver.dpm(context).clearUserRestriction(AdminReceiver.component(context),key);remaining-=key
        }.onFailure { DeviceLog.event(context,"warning","safety","settings_restore_failed",it,JSONObject().put("restriction",key)) }
        p.edit().putStringSet("owned",remaining.toSet()).remove("results").commit()
    }
    fun status(context:Context)=runCatching { JSONObject(prefs(context).getString("results","{}")!!) }.getOrElse { JSONObject() }
}
