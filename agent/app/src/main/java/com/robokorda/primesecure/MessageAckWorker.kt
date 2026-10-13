package com.robokorda.primesecure

import android.content.Context
import androidx.work.*
import org.json.JSONObject

/** Acknowledgements never wait behind large school-resource downloads. */
class MessageAckWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val store = AgentStore(applicationContext)
        if (!store.isEnrolled) return Result.success()
        val hub = HubStore(applicationContext)
        return try {
            for (message in hub.messages().filter { it.optBoolean("acknowledged") && !it.optBoolean("ack_synced") }) {
                SupabaseApi(store).rpc("device_ack_message", JSONObject().put("p_command_id", message.getString("id")))
                hub.acknowledge(message.getString("id"), true)
            }
            Result.success()
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            Result.retry()
        }
    }
    companion object {
        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniqueWork("message-acknowledgements", ExistingWorkPolicy.APPEND_OR_REPLACE,
                OneTimeWorkRequestBuilder<MessageAckWorker>().setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
        }
    }
}
