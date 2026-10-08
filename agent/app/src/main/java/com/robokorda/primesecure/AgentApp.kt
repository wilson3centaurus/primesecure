package com.robokorda.primesecure

import android.app.Application

class AgentApp : Application() {
    override fun onCreate() {
        super.onCreate()
        if (AgentStore(this).isEnrolled) {
            CheckInWorker.schedule(this)
            AgentService.start(this)
        }
    }
}
