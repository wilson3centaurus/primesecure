package com.robokorda.primesecure

import android.content.Context
import androidx.work.*
import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class DiagnosticsWorker(c:Context,p:WorkerParameters):CoroutineWorker(c,p) {
    override suspend fun doWork():Result {
        val store=AgentStore(applicationContext);val device=store.deviceId
        if(!store.isEnrolled || store.lastStatus=="retired")return Result.success()
        return try {
            repeat(7) {
                if(AgentStore(applicationContext).deviceId!=device)return Result.success()
                val events=DeviceLog.batch(applicationContext,device)
                if(events.length()==0)return Result.success()
                val result=SupabaseApi(store).rpc("device_report_events",JSONObject().put("p_device_id",device).put("p_events",events))
                DeviceLog.acknowledge(applicationContext,result.stringSet("accepted_ids"))
            }
            Result.success()
        } catch(e:Exception) {
            if(e is CancellationException)throw e
            // Never log the logger's own upload failures back into its queue.
            Result.retry()
        }
    }
    companion object {
        fun schedule(c:Context) {
            val connected=Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            WorkManager.getInstance(c).enqueueUniqueWork("diagnostics-now",ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<DiagnosticsWorker>().setConstraints(connected).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build())
            WorkManager.getInstance(c).enqueueUniquePeriodicWork("diagnostics",ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<DiagnosticsWorker>(15,TimeUnit.MINUTES).setConstraints(connected).build())
        }
    }
}
