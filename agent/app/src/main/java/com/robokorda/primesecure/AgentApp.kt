package com.robokorda.primesecure

import android.app.Application
import androidx.work.Configuration
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class AgentApp : Application(), Configuration.Provider {
    // A process started for LOCKED_BOOT_COMPLETED can outlive first unlock.
    // Its credential-protected Startup provider may never have run. Every existing
    // getInstance(context) caller can now initialize WorkManager on demand instead.
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().build()

    override fun onCreate() {
        super.onCreate()
        DeviceLog.install(this)
        if(getSystemService(android.os.UserManager::class.java).isUserUnlocked)DeviceSafety.finishRollback(this)
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
