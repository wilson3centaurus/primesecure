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
        val recovery=PasswordRecovery.status(activity)
        val lastPrompt=prefs.getLong("recovery_prompted_at",0L)
        val retryDue=System.currentTimeMillis()-lastPrompt>=24L*60L*60L*1000L
        if(AdminReceiver.isDeviceOwner(activity)&&recovery!="ready"&&recovery!="unsupported"&&retryDue) {
            // With no existing screen credential Android activates the escrow token
            // immediately. If a credential already exists, Android requires the
            // student to confirm it; retry at most daily after a dismissal/failure.
            prefs.edit().putLong("recovery_prompted_at",System.currentTimeMillis()).commit()
            runCatching { PasswordRecovery.activate(activity) }.onSuccess {
                if(PasswordRecovery.status(activity)=="ready")prefs.edit().putBoolean("recovery_ready",true).commit()
            }.onFailure {
                DeviceLog.event(activity,"warn","setup","recovery_needs_attention")
            }
        }
    }
}
