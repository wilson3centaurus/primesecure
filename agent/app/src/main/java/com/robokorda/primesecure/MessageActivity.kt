package com.robokorda.primesecure

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Shows a message from school staff on top of whatever the student is doing. */
class MessageActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        setFinishOnTouchOutside(false)
        render(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        render(intent)
    }

    private fun render(intent: Intent) {
        val id = intent.getStringExtra(EXTRA_ID).orEmpty()
        Notifications.cancelMessage(this, id)
        title = intent.getStringExtra(EXTRA_TITLE) ?: "Message"

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(56, 48, 56, 32)
            minimumWidth = (resources.displayMetrics.widthPixels * 0.5).toInt()
        }
        intent.getStringExtra(EXTRA_FROM)?.takeIf { it.isNotBlank() }?.let { from ->
            root.addView(TextView(this).apply {
                text = "From $from"
                textSize = 14f
                alpha = 0.7f
                setPadding(0, 0, 0, 16)
            })
        }
        root.addView(TextView(this).apply {
            text = intent.getStringExtra(EXTRA_BODY).orEmpty()
            textSize = 20f
            setTextIsSelectable(true)
            setPadding(0, 0, 0, 32)
        })
        root.addView(Button(this).apply {
            text = "OK"
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { gravity = Gravity.END }
            setOnClickListener { finish() }
        })
        setContentView(root)
    }

    companion object {
        private const val EXTRA_ID = "id"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_BODY = "body"
        private const val EXTRA_FROM = "from"

        fun intent(context: Context, id: String, title: String, body: String, from: String?): Intent =
            Intent(context, MessageActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .setData(android.net.Uri.parse("primesecure://message/$id")) // one task entry per message
                .putExtra(EXTRA_ID, id)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_BODY, body)
                .putExtra(EXTRA_FROM, from)
    }
}
