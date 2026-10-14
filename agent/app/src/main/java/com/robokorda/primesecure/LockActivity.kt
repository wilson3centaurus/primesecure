package com.robokorda.primesecure

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import java.lang.ref.WeakReference

/**
 * Full-screen "this Primebook is locked" screen. Runs in lock task mode (we
 * whitelist ourselves as Device Owner), so home, recents and other apps are
 * unreachable until the school unlocks the device.
 */
class LockActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = WeakReference(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        render()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        render()
    }

    override fun onResume() {
        super.onResume()
        if (AgentStore(this).lastStatus != "locked") return unlock()
        runCatching { startLockTask() }
    }

    override fun onDestroy() {
        if (current?.get() === this) current = null
        super.onDestroy()
    }

    @Deprecated("Locked: back does nothing")
    @Suppress("DEPRECATION")
    override fun onBackPressed() = Unit

    fun unlock() {
        runCatching { stopLockTask() }
        finish()
    }

    private fun render() {
        val message = AgentStore(this).lastStatusMessage
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.rgb(15, 23, 42))
            setPadding(64, 64, 64, 64)
        }
        root.addView(TextView(this).apply {
            text = "This Primebook is locked"
            textSize = 32f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = message?.takeIf { it.isNotBlank() } ?: "Please see your teacher or the school office."
            textSize = 20f
            setTextColor(Color.rgb(203, 213, 225))
            gravity = Gravity.CENTER
            setPadding(0, 32, 0, 0)
        })
        val contacts=HubStore(this).catalog.optJSONArray("support_contacts")
        if(contacts!=null)root.addView(TextView(this).apply {
            text=(0 until contacts.length()).joinToString("\n") { val c=contacts.getJSONObject(it);"${c.optString("name")}: ${c.optString("phone")}" }
            textSize=16f;setTextColor(Color.rgb(203,213,225));setPadding(0,24,0,18)
        })
        root.addView(android.widget.Button(this).apply { text="Check for unlock";setOnClickListener { CheckInWorker.runNow(this@LockActivity);android.widget.Toast.makeText(this@LockActivity,"Check-in requested. Waiting for your school.",android.widget.Toast.LENGTH_LONG).show() } })
        root.addView(android.widget.Button(this).apply { text="Message RoboKorda support";setOnClickListener {
            val input=android.widget.EditText(this@LockActivity).apply { hint="How can we help?";maxLines=6 }
            android.app.AlertDialog.Builder(this@LockActivity).setTitle("RoboKorda support").setView(input).setNegativeButton("Cancel",null).setPositiveButton("Send") { _,_ ->
                val body=input.text.toString().trim().take(4000)
                if(body.isNotEmpty()) { HubTasks(this@LockActivity).enqueue("support",org.json.JSONObject().put("body",body),"Support message from locked device");OfflineWorker.schedule(this@LockActivity);android.widget.Toast.makeText(this@LockActivity,"Saved. Your message will send when internet is available.",android.widget.Toast.LENGTH_LONG).show() }
            }.show()
        } })
        setContentView(root)
    }

    companion object {
        private var current: WeakReference<LockActivity>? = null

        fun intent(context: Context): Intent =
            Intent(context, LockActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

        /** Must be called on the main thread. */
        fun finishIfShowing() {
            current?.get()?.unlock()
        }
    }
}
