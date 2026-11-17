package com.robokorda.primesecure

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.lang.ref.WeakReference

/** Full-screen commercial licence hold. It never changes the MDM device status. */
class RoboKordaLicenceActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = WeakReference(this)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        render()
    }

    override fun onResume() {
        super.onResume()
        if (!RoboKordaLicence.isEnforced(this)) return release()
        runCatching { startLockTask() }
    }

    override fun onDestroy() {
        if (current?.get() === this) current = null
        super.onDestroy()
    }

    @Deprecated("Licence hold: back does nothing")
    @Suppress("DEPRECATION")
    override fun onBackPressed() = Unit

    private fun render() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(72, 72, 72, 72)
            setBackgroundColor(Color.rgb(15, 23, 42))
        }
        root.addView(TextView(this).apply {
            text = "RoboKorda licence needs attention"
            textSize = 32f; gravity = Gravity.CENTER; setTextColor(Color.WHITE)
        })
        root.addView(TextView(this).apply {
            text = "Prime ID: ${RoboKordaLicence.primeId(this@RoboKordaLicenceActivity)}\n\nAsk your school administrator or RoboKorda to renew this PrimeBook licence. Your school files and MDM enrollment are unchanged."
            textSize = 19f; gravity = Gravity.CENTER; setTextColor(Color.rgb(203, 213, 225)); setPadding(0, 28, 0, 28)
        })
        root.addView(Button(this).apply {
            text = "Check licence again"
            setOnClickListener {
                CheckInWorker.runNow(this@RoboKordaLicenceActivity)
                android.widget.Toast.makeText(this@RoboKordaLicenceActivity, "Checking with RoboKorda…", android.widget.Toast.LENGTH_LONG).show()
            }
        })
        setContentView(root)
    }

    private fun release() { runCatching { stopLockTask() }; finish() }

    companion object {
        private var current: WeakReference<RoboKordaLicenceActivity>? = null
        fun intent(context: Context) = Intent(context, RoboKordaLicenceActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        fun finishIfShowing() { current?.get()?.release() }
    }
}
