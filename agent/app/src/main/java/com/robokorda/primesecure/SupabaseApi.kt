package com.robokorda.primesecure

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class ApiException(val code: Int, message: String) : Exception(message)

/**
 * Just the slice of Supabase the agent needs: the enroll function, password /
 * refresh-token auth for the device account, and RPCs. Kept dependency-free
 * beyond OkHttp so the APK stays small and easy to audit.
 */
class SupabaseApi(private val store: AgentStore) {

    suspend fun enroll(token: String, info: JSONObject): JSONObject {
        val body = JSONObject(info.toString()).put("token", token)
        return post("/functions/v1/enroll", body, bearer = store.anonKey)
    }

    suspend fun rpc(name: String, args: JSONObject = JSONObject()): JSONObject {
        return try {
            post("/rest/v1/rpc/$name", args, bearer = accessToken())
        } catch (e: ApiException) {
            if (e.code != 401) throw e
            // Token revoked or clock skew: drop it and sign in again once.
            store.accessToken = null
            post("/rest/v1/rpc/$name", args, bearer = accessToken())
        }
    }

    /** A valid access token for the device account, refreshing or signing in again as needed. */
    suspend fun accessToken(): String {
        val current = store.accessToken
        if (current != null && System.currentTimeMillis() < store.accessExpiresAt - 60_000) return current

        store.refreshToken?.let { refresh ->
            try {
                return saveSession(post("/auth/v1/token?grant_type=refresh_token",
                    JSONObject().put("refresh_token", refresh), bearer = store.anonKey))
            } catch (e: ApiException) {
                if (e.code >= 500) throw e
                store.refreshToken = null // expired or rotated away; fall back to the password
            }
        }

        val email = store.email ?: throw ApiException(0, "Not enrolled")
        val password = store.password ?: throw ApiException(0, "Not enrolled")
        return saveSession(post("/auth/v1/token?grant_type=password",
            JSONObject().put("email", email).put("password", password), bearer = store.anonKey))
    }

    private fun saveSession(session: JSONObject): String {
        val token = session.getString("access_token")
        store.accessToken = token
        store.refreshToken = session.optString("refresh_token").takeIf { it.isNotEmpty() }
        store.accessExpiresAt = System.currentTimeMillis() + session.optLong("expires_in", 3600) * 1000
        return token
    }

    private suspend fun post(path: String, body: JSONObject, bearer: String): JSONObject =
        withContext(Dispatchers.IO) {
            val base = store.serverUrl
            if (base.isBlank()) throw ApiException(0, "No server URL configured")
            val request = Request.Builder()
                .url(base.trimEnd('/') + path)
                .header("apikey", store.anonKey)
                .header("Authorization", "Bearer $bearer")
                .post(body.toString().toRequestBody(JSON))
                .build()
            http.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) throw ApiException(response.code, errorMessage(response.code, text))
                if (text.isBlank() || text == "null") JSONObject() else JSONObject(text)
            }
        }

    private fun errorMessage(code: Int, text: String): String {
        val detail = runCatching {
            val j = JSONObject(text)
            j.optString("message").ifEmpty { j.optString("error_description") }.ifEmpty { j.optString("error") }
        }.getOrNull()
        return "HTTP $code: ${detail?.ifEmpty { null } ?: text.take(200)}"
    }

    companion object {
        private val JSON = "application/json".toMediaType()
        val http: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .callTimeout(60, TimeUnit.SECONDS)
            .build()
    }
}
