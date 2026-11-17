package com.robokorda.primesecure

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

internal class DeviceSetupApi(context:Context) {
    private val store=AgentStore(context)
    private val json="application/json".toMediaType()

    suspend fun verifyCode(secret:String,code:String,identity:JSONObject):JSONObject = post("/functions/v1/device-setup",
        JSONObject(identity.toString()).put("action","verify_code").put("setup_code",code).put("request_secret",secret),null)

    suspend fun assign(secret:String,session:String,studentName:String,classForm:Int,classSection:String):JSONObject = post("/functions/v1/device-setup",
        JSONObject().put("action","assign").put("session_id",session).put("student_name",studentName)
            .put("class_form",classForm).put("class_section",classSection).put("request_secret",secret),null)

    suspend fun activate(secret:String,session:String):JSONObject = post("/functions/v1/device-setup",
        JSONObject().put("action","activate").put("session_id",session).put("request_secret",secret),null)

    private suspend fun post(path:String,body:JSONObject,bearer:String?):JSONObject=withContext(Dispatchers.IO) {
        val key=store.anonKey.takeIf { it.isNotBlank() } ?: error("PrimeSecure server key is not configured.")
        val request=Request.Builder().url(store.serverUrl.trimEnd('/')+path).header("apikey",key)
            .header("Authorization","Bearer ${bearer ?: key}")
            .post(body.toString().toRequestBody(json)).build()
        SupabaseApi.http.newCall(request).execute().use { response ->
            val text=response.body?.string().orEmpty();val parsed=runCatching { JSONObject(text) }.getOrElse { JSONObject() }
            if(!response.isSuccessful) {
                val code=parsed.optString("error")
                error(when(code){
                    "invalid_request_secret" -> "This setup request is no longer valid. Restart setup or contact RoboKorda."
                    "invalid_setup_code" -> "Enter the six-digit setup code provided by your school."
                    "unknown_setup_code" -> "That setup code is invalid or has expired. Ask your school for a new code."
                    "setup_code_in_use" -> "That setup code is already being used on another PrimeBook. Ask your school for a new code."
                    "invalid_student_name" -> "Enter the student's full name."
                    "identity_unavailable" -> "This PrimeBook could not read its hardware identity. Open technician diagnostics."
                    else -> parsed.optString("msg").ifBlank { parsed.optString("message") }.ifBlank { "Server request failed (${response.code})." }
                })
            }
            parsed
        }
    }
}
