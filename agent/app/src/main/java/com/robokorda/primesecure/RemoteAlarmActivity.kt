package com.robokorda.primesecure

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class RemoteAlarmActivity : Activity() {
    override fun onCreate(state:Bundle?) {
        super.onCreate(state)
        val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;gravity=Gravity.CENTER;setPadding(40,40,40,40);setBackgroundColor(Color.rgb(255,241,242)) }
        root.addView(TextView(this).apply { text="School high-alert alarm";textSize=28f;setTextColor(Color.rgb(159,18,57)) })
        root.addView(TextView(this).apply { text="Your school requested this audible alert. It stops automatically within 30 seconds. You can stop it now.\n\n"+intent.getStringExtra("reason").orEmpty();textSize=18f;setPadding(0,30,0,30) })
        root.addView(Button(this).apply { text="Stop alarm";setOnClickListener { stopService(Intent(this@RemoteAlarmActivity,RemoteAlarmService::class.java));finish() } })
        setContentView(root)
    }
    @Deprecated("Back stops the visible alarm")
    @Suppress("DEPRECATION")
    override fun onBackPressed() { stopService(Intent(this,RemoteAlarmService::class.java));super.onBackPressed() }
}
