package com.robokorda.primesecure

import android.content.Context
import java.util.UUID

internal class DeviceSetupStore(context:Context) {
    private val prefs=context.getSharedPreferences("device-setup",Context.MODE_PRIVATE)
    var studentName:String? by string("student")
    var sessionId:String? by string("session_id")
    var assignmentState:String? by string("assignment_state")
    var schoolName:String? by string("school_name")
    var assignmentDate:String? by string("assignment_date")
    var hardwareId:String? by string("hardware_id")
    var enrollmentKey:String? by string("enrollment_key")
    var classForm:String? by string("class_form")
    var classSection:String? by string("class_section")
    val requestSecret:String
        get()=prefs.getString("request_secret",null) ?: UUID.randomUUID().toString().let {
            prefs.edit().putString("request_secret",it).commit();it
        }
    fun clear(){prefs.edit().clear().commit()}
    private fun string(name:String)=object:kotlin.properties.ReadWriteProperty<Any?,String?>{
        override fun getValue(thisRef:Any?,property:kotlin.reflect.KProperty<*>)=prefs.getString(name,null)
        override fun setValue(thisRef:Any?,property:kotlin.reflect.KProperty<*>,value:String?){prefs.edit().putString(name,value).apply()}
    }
}
