package com.robokorda.primesecure

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class CheckInWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        if (!AgentStore(applicationContext).isEnrolled) return Result.success()
        return try {
            checkIn(applicationContext)
            Result.success()
        } catch (e: IOException) {
            Result.retry()
        } catch (e: ApiException) {
            if (e.code >= 500 || e.code == 429) Result.retry() else Result.success()
        }
    }

    companion object {
        private const val PERIODIC = "check-in"
        private const val NOW = "check-in-now"

        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        /** WorkManager's minimum interval; survives reboots and app restarts on its own. */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<CheckInWorker>(15, TimeUnit.MINUTES)
                .setConstraints(online)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun runNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<CheckInWorker>()
                .setConstraints(online)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
            WorkManager.getInstance(context).cancelUniqueWork(NOW)
        }

        /** One heartbeat: report device state, receive status + policy, apply it. */
        suspend fun checkIn(context: Context): JSONObject {
            val store = AgentStore(context)
            try {
                DeviceInfo.grantOwnPermissions(context)
                val response = SupabaseApi(store).rpc(
                    "device_check_in",
                    JSONObject().put("p_info", DeviceInfo.collect(context)),
                )
                store.lastStatus = response.optString("status")
                store.lastPolicySummary = PolicyApplier(context, store)
                    .apply(response.optJSONObject("policy") ?: JSONObject())
                store.lastCheckInAt = System.currentTimeMillis()
                store.lastError = null
                return response
            } catch (e: Exception) {
                store.lastError = "${e.javaClass.simpleName}: ${e.message}"
                throw e
            }
        }

        /** Exchanges an enroll token for this device's own account, then checks in. */
        suspend fun enroll(context: Context, token: String): JSONObject {
            val store = AgentStore(context)
            if (!AdminReceiver.isDeviceOwner(context)) {
                throw IllegalStateException("Not Device Owner yet — run the dpm set-device-owner command first")
            }
            DeviceInfo.grantOwnPermissions(context)
            val result = SupabaseApi(store).enroll(token.trim().uppercase(), DeviceInfo.collect(context))
            store.saveEnrollment(
                deviceId = result.getString("device_id"),
                email = result.getString("email"),
                password = result.getString("password"),
            )
            schedule(context)
            return checkIn(context)
        }
    }
}
