package com.robokorda.primesecure

import android.app.Application

class AgentApp : Application() {
    override fun onCreate() {
        super.onCreate()
        if(!getSystemService(android.os.UserManager::class.java).isUserUnlocked)return
        if (AgentStore(this).isEnrolled) {
            CheckInWorker.schedule(this)
            AgentService.start(this)
        }
    }
}
