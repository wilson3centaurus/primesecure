package com.robokorda.primesecure

import android.content.Context
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

class UnsupportedCommand(type: String) : Exception("'$type' is not supported by agent ${BuildConfig.VERSION_NAME}")

/**
 * Fetches queued commands and runs them one at a time, reporting each result.
 * A command may be handed out again if we died before acking it, so every
 * handler must be safe to repeat.
 */
class CommandRunner(private val context: Context, private val store: AgentStore) {

    private val api = SupabaseApi(store)

    suspend fun runPending() = lock.withLock {
        repeat(MAX_BATCHES) {
            val commands = api.rpc("device_fetch_commands", JSONObject().put("p_limit", BATCH))
                .optJSONArray("commands") ?: return@withLock
            for (i in 0 until commands.length()) run(commands.getJSONObject(i))
            if (commands.length() < BATCH) return@withLock
        }
    }

    private suspend fun run(command: JSONObject) {
        val id = command.getString("id")
        val type = command.getString("type")
        val payload = command.optJSONObject("payload") ?: JSONObject()

        val (status, result) = try {
            "succeeded" to execute(id, type, payload)
        } catch (e: Exception) {
            "failed" to JSONObject().put("error", e.message ?: e.javaClass.simpleName)
        }
        runCatching {
            api.rpc("device_ack_command", JSONObject()
                .put("p_command_id", id).put("p_status", status).put("p_result", result))
        }
    }

    private suspend fun execute(id: String, type: String, payload: JSONObject): JSONObject = when (type) {
        "message" -> showMessage(id, payload)
        "install_apk" -> AppInstaller(context, store).install(id, payload)
        "remove_apk" -> AppInstaller(context, store).uninstall(payload)
        "locate" -> Locator(context, store).locate()
        "list_files" -> FileManager(store).list(payload)
        "push_file" -> FileManager(store).push(payload)
        "delete_file" -> FileManager(store).delete(payload)
        else -> throw UnsupportedCommand(type)
    }

    private fun showMessage(id: String, payload: JSONObject): JSONObject {
        // Redelivered after a failed ack: it was already on screen, just ack it again.
        if (id in store.shownMessageIds) return JSONObject().put("note", "already shown")
        val body = payload.stringOrNull("body") ?: throw IllegalArgumentException("empty message")
        val title = payload.stringOrNull("title") ?: "Message from school"
        val from = payload.stringOrNull("from")
        // The full-screen notification is the fallback if the activity can't start from the background.
        Notifications.message(context, id, title, body, from)
        context.startActivity(MessageActivity.intent(context, id, title, body, from))
        store.shownMessageIds = (store.shownMessageIds + id).takeLast(50)
        return JSONObject().put("shown_at", System.currentTimeMillis())
    }

    companion object {
        private const val BATCH = 20
        private const val MAX_BATCHES = 5
        private val lock = Mutex()
    }
}
