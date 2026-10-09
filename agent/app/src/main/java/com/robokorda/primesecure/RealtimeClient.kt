package com.robokorda.primesecure

import android.util.Log
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger

/**
 * Minimal Supabase Realtime client (Phoenix protocol v1 over OkHttp). Subscribes
 * to new commands for this device, policy edits and updates to its own device
 * row, and calls [onChange] for each — the caller decides whether to check in.
 * Realtime applies RLS, so only our own rows arrive.
 *
 * Reconnects with backoff, and every 45 minutes so the access token in the
 * join payload never expires mid-connection.
 */
class RealtimeClient(
    private val store: AgentStore,
    private val scope: CoroutineScope,
    private val onConnected: () -> Unit,
    private val onChange: (table: String, record: JSONObject?) -> Unit,
) {
    private var loop: Job? = null
    private val ref = AtomicInteger(1)

    fun start() {
        if (loop?.isActive == true) return
        loop = scope.launch {
            var backoffMs = INITIAL_BACKOFF_MS
            while (isActive) {
                val startedAt = System.currentTimeMillis()
                try {
                    runSession()
                } catch (e: Exception) {
                    Log.w(TAG, "realtime session ended: ${e.message}")
                }
                // A session that stayed up a while was healthy; retry promptly.
                if (System.currentTimeMillis() - startedAt > 5 * 60_000) backoffMs = INITIAL_BACKOFF_MS
                delay(backoffMs)
                backoffMs = (backoffMs * 2).coerceAtMost(MAX_BACKOFF_MS)
            }
        }
    }

    fun stop() {
        loop?.cancel()
        loop = null
    }

    /** Connects, joins, heartbeats; returns when the socket closes or the session ages out. */
    private suspend fun runSession() {
        val deviceId = store.deviceId ?: error("not enrolled")
        val token = SupabaseApi(store).accessToken()
        val base = store.serverUrl.trimEnd('/')
            .replaceFirst("https://", "wss://").replaceFirst("http://", "ws://")
        val url = "$base/realtime/v1/websocket?apikey=${store.anonKey}&vsn=1.0.0"

        val closed = CompletableDeferred<Unit>()
        val topic = "realtime:device-$deviceId"
        val joinRef = ref.getAndIncrement().toString()

        val socket = SupabaseApi.http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val changes = JSONArray()
                    .put(change("INSERT", "commands", "device_id=eq.$deviceId"))
                    .put(change("*", "policies", null))
                    .put(change("UPDATE", "devices", "id=eq.$deviceId"))
                val payload = JSONObject()
                    .put("config", JSONObject()
                        .put("broadcast", JSONObject().put("self", false))
                        .put("presence", JSONObject().put("key", ""))
                        .put("postgres_changes", changes))
                    .put("access_token", token)
                webSocket.send(message(topic, "phx_join", payload, joinRef, joinRef))
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val msg = runCatching { JSONObject(text) }.getOrNull() ?: return
                if (msg.optString("topic") != topic) return
                when (msg.optString("event")) {
                    "phx_reply" -> if (msg.optString("ref") == joinRef) {
                        val status = msg.optJSONObject("payload")?.optString("status")
                        if (status == "ok") onConnected() else {
                            Log.w(TAG, "join refused: $text")
                            webSocket.close(1000, "join refused")
                        }
                    }
                    "postgres_changes" -> {
                        val data = msg.optJSONObject("payload")?.optJSONObject("data")
                        onChange(data?.optString("table").orEmpty(), data?.optJSONObject("record"))
                    }
                    "phx_error", "phx_close" -> webSocket.close(1000, null)
                    "system" -> {
                        val payload = msg.optJSONObject("payload")
                        if (payload?.optString("status") == "error") Log.w(TAG, "realtime: $text")
                    }
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                closed.complete(Unit)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                closed.complete(Unit)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w(TAG, "realtime failure: ${t.message}")
                closed.complete(Unit)
            }
        })

        try {
            val endAt = System.currentTimeMillis() + SESSION_MS
            while (!closed.isCompleted && System.currentTimeMillis() < endAt) {
                delay(HEARTBEAT_MS)
                if (closed.isCompleted) break
                socket.send(message("phoenix", "heartbeat", JSONObject(), ref.getAndIncrement().toString(), null))
            }
        } finally {
            socket.close(1000, null)
        }
    }

    private fun change(event: String, table: String, filter: String?) = JSONObject()
        .put("event", event).put("schema", "public").put("table", table)
        .apply { if (filter != null) put("filter", filter) }

    private fun message(topic: String, event: String, payload: JSONObject, ref: String, joinRef: String?) =
        JSONObject()
            .put("topic", topic).put("event", event).put("payload", payload).put("ref", ref)
            .put("join_ref", joinRef ?: JSONObject.NULL)
            .toString()

    companion object {
        private const val TAG = "PrimeSecureRealtime"
        private const val HEARTBEAT_MS = 25_000L
        private const val SESSION_MS = 45 * 60_000L
        private const val INITIAL_BACKOFF_MS = 5_000L
        private const val MAX_BACKOFF_MS = 5 * 60_000L
    }
}
