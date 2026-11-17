package com.robokorda.primesecure

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper

/** Releases the setup gate to the real PrimeOS desktop, then opens PrimeSecure after five seconds. */
class OfflineDesktopPreviewActivity : Activity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        if (!BuildConfig.FIRST_BOOT_TEST_MODE) { finish(); return }
        OfflineDesktopHandoff.schedule(applicationContext)
        SetupGatePolicy.completeOfflineTest(this)
        finish()
    }
}

private object OfflineDesktopHandoff {
    private val handler = Handler(Looper.getMainLooper())
    fun schedule(context: android.content.Context) {
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({
            context.startActivity(Intent(context, HubActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra("offline_first_boot_welcome", true))
        }, 5_000)
    }
}
