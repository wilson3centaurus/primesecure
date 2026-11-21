package com.robokorda.primesecure

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
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

    suspend fun rpc(name: String, args: JSONObject = JSONObject(), schema: String = "public"): JSONObject {
        require(schema.matches(Regex("^[a-z][a-z0-9_]{0,62}$"))) { "Invalid API schema" }
        return try {
            post("/rest/v1/rpc/$name", args, bearer = accessToken(), schema = schema)
        } catch (e: ApiException) {
            if (e.code != 401) throw e
            // Token revoked or clock skew: drop it and sign in again once.
            store.accessToken = null
            post("/rest/v1/rpc/$name", args, bearer = accessToken(), schema = schema)
        }
    }

    /** Combines the legacy public catalogue with the schema-isolated chat payload. */
    suspend fun deviceHub(): JSONObject = rpc("device_hub")
        .put("student_chat", rpc("device_chat_hub", schema = "primesecure"))
        .put("student_chat_features", true)

    /** Downloads a file (e.g. a storage object) as the device account into [target]. */
    suspend fun download(path: String, target: File, resume: Boolean = false, maxBytes: Long = Long.MAX_VALUE, progress: ((Long, Long, Long) -> Unit)? = null) = withContext(Dispatchers.IO) {
        require(maxBytes > 0 && target.length() <= maxBytes) { "Download exceeds the size limit" }
        val base = store.serverUrl
        if (base.isBlank()) throw ApiException(0, "No server URL configured")
        val coroutine = currentCoroutineContext()
        for (attempt in 0..1) {
        var reauthenticate = false
        val request = Request.Builder()
            .url(base.trimEnd('/') + path)
            .header("apikey", store.anonKey)
            .header("Authorization", "Bearer ${accessToken()}")
            .apply { if (resume && target.exists() && target.length() > 0) header("Range", "bytes=${target.length()}-") }
            .get()
            .build()
        downloadHttp.newCall(request).executeCancellable { response ->
            if (response.code == 401 && attempt == 0) {
                reauthenticate = true
                return@executeCancellable
            }
            if (!response.isSuccessful) throw ApiException(response.code, errorMessage(response.code, response.body?.string().orEmpty()))
            val body = response.body ?: throw ApiException(response.code, "empty body")
            val append = resume && response.code == 206
            var bytes = if (append) target.length() else 0L
            val total = body.contentLength().takeIf { it >= 0 }?.plus(bytes) ?: 0L
            require(total >= 0 && total <= maxBytes) { "Download exceeds the size limit" }
            var checkpoint = android.os.SystemClock.elapsedRealtime(); var previous = bytes
            progress?.invoke(bytes, total, 0)
            java.io.FileOutputStream(target, append).use { out -> body.byteStream().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    coroutine.ensureActive()
                    val count = input.read(buffer); if (count < 0) break
                    require(count.toLong() <= maxBytes - bytes) { "Download exceeds the size limit" }
                    out.write(buffer, 0, count); bytes += count
                    val now = android.os.SystemClock.elapsedRealtime()
                    if (now - checkpoint >= 750) {
                        progress?.invoke(bytes, total, (bytes - previous) * 1000 / (now - checkpoint))
                        checkpoint = now; previous = bytes
                    }
                }
            } }
            progress?.invoke(bytes, total, 0)
        }
        if (!reauthenticate) break
        store.accessToken = null
        }
    }

    /** A valid access token for the device account, refreshing or signing in again as needed. */
    suspend fun accessToken(): String = sessionLock.withLock { accessTokenUnlocked() }

    private suspend fun accessTokenUnlocked(): String {
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

    private suspend fun post(path: String, body: JSONObject, bearer: String, schema: String? = null): JSONObject =
        withContext(Dispatchers.IO) {
            val base = store.serverUrl
            if (base.isBlank()) throw ApiException(0, "No server URL configured")
            val request = Request.Builder()
                .url(base.trimEnd('/') + path)
                .header("apikey", store.anonKey)
                .header("Authorization", "Bearer $bearer")
                .apply {
                    if (schema != null) {
                        header("Accept-Profile", schema)
                        header("Content-Profile", schema)
                    }
                }
                .post(body.toString().toRequestBody(JSON))
                .build()
            http.newCall(request).executeCancellable { response ->
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
        private val sessionLock = Mutex()
        private val JSON = "application/json".toMediaType()
        val http: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .callTimeout(60, TimeUnit.SECONDS)
            .build()

        /** APKs and files can be large on school Wi-Fi: no overall call deadline. */
        private val downloadHttp: OkHttpClient = http.newBuilder()
            .callTimeout(0, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()
    }
}
