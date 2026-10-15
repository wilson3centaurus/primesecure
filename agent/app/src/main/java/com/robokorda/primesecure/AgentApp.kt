package com.robokorda.primesecure

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class AgentApp : Application() {
    override fun onCreate() {
        super.onCreate()
        DeviceLog.install(this)
        if(!getSystemService(android.os.UserManager::class.java).isUserUnlocked)return
        CoroutineScope(SupervisorJob()+Dispatchers.IO).launch {
            if(AgentStore(this@AgentApp).isEnrolled) {
                DeviceLog.bind(this@AgentApp,AgentStore(this@AgentApp).deviceId)
                DiagnosticsWorker.schedule(this@AgentApp)
            }
            runCatching { AppSafety.restoreEssentialApps(this@AgentApp) }
            if (AgentStore(this@AgentApp).isEnrolled) {
                CheckInWorker.schedule(this@AgentApp)
                AgentService.start(this@AgentApp)
            }
        }
    }
}
