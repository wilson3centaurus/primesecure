package com.robokorda.primesecure

import android.app.Activity
import android.content.Context

/** Local, per-enrollment progress; completing a tour never grants Android privileges. */
internal class StudentWelcome(context: Context) {
    private val prefs = context.getSharedPreferences("student-welcome", Context.MODE_PRIVATE)
    init { val device=AgentStore(context).deviceId
        if(prefs.getString("device",null)!=device) check(prefs.edit().clear().putString("device",device).commit())
    }
    val complete get()=prefs.getBoolean("complete",false)
    val step get()=prefs.getInt("step",0).coerceIn(0,4)
    fun advance(next:Int) { require(next in 0..4 && next<=step+1);check(prefs.edit().putInt("step",next).commit()) }
    fun finish() { check(step==4);check(prefs.edit().putBoolean("complete",true).commit()) }
}

internal object EnrollmentStartup {
    fun apply(activity:Activity) {
        if(!AgentStore(activity).isEnrolled)return
        DeviceInfo.grantOwnPermissions(activity)
        val prefs=activity.getSharedPreferences("enrollment-permissions",Context.MODE_PRIVATE)
        val device=AgentStore(activity).deviceId
        if(prefs.getString("device",null)!=device)prefs.edit().clear().putString("device",device).commit()
        if(AdminReceiver.isDeviceOwner(activity)&&!prefs.getBoolean("recovery_attempted",false)) {
            prefs.edit().putBoolean("recovery_attempted",true).commit()
            runCatching { PasswordRecovery.activate(activity) }.onFailure {
                DeviceLog.event(activity,"warn","setup","recovery_needs_attention")
            }
        }
    }
}
