package com.robokorda.primesecure

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout

/** Dedicated pre-enrollment wizard task; the enrolled HOME activity stays separate. */
class SetupGateActivity : Activity() {
    override fun onCreate(state: Bundle?) {
        hidePrimeOsWindowHeader()
        super.onCreate(state)
        if (SetupGatePolicy.setupComplete(this)) { SetupGatePolicy.completeSetup(this); return }
        render()
        SetupGatePolicy.enter(this)
        SetupGatePolicy.record(this, "gate_created:${intent.getStringExtra("launch_reason") ?: "direct"}")
    }

    override fun onNewIntent(value: Intent) {
        super.onNewIntent(value)
        hidePrimeOsWindowHeader()
        intent = value
        if (SetupGatePolicy.setupComplete(this)) SetupGatePolicy.completeSetup(this) else SetupGatePolicy.enter(this)
    }

    override fun onResume() {
        hidePrimeOsWindowHeader()
        super.onResume()
        if (SetupGatePolicy.setupComplete(this)) { SetupGatePolicy.completeSetup(this); return }
        SetupGatePolicy.enter(this)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            hidePrimeOsWindowHeader()
            SetupGatePolicy.configureLikeRequiredNotice(this)
        }
    }

    @Deprecated("Setup cannot be skipped")
    override fun onBackPressed() = Unit

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode in setOf(KeyEvent.KEYCODE_META_LEFT, KeyEvent.KEYCODE_META_RIGHT, KeyEvent.KEYCODE_HOME)) return true
        return super.dispatchKeyEvent(event)
    }

    private fun hidePrimeOsWindowHeader() {
        runCatching {
            val configuration = resources.configuration
            val windowConfiguration = configuration.javaClass.getField("windowConfiguration").get(configuration)
            windowConfiguration.javaClass.getMethod("setHideHeader", Boolean::class.javaPrimitiveType)
                .invoke(windowConfiguration, true)
        }
    }

    private fun render() {
        val root = FrameLayout(this)
        root.addView(ImageView(this).apply {
            setImageResource(R.drawable.primeos_welcome_forest)
            scaleType = ImageView.ScaleType.CENTER_CROP
            contentDescription = null
        }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(View(this).apply { setBackgroundColor(Color.argb(72, 5, 17, 45)) },
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(38), dp(28), dp(38), dp(30))
            background = FirstBootUi.rounded(this@SetupGateActivity, Color.argb(232, 250, 252, 255), 28, Color.argb(150, 255, 255, 255))
            addView(ImageView(this@SetupGateActivity).apply {
                setImageResource(R.drawable.primebook_transparent)
                contentDescription = "PrimeOS"
                scaleType = ImageView.ScaleType.FIT_CENTER
            }, LinearLayout.LayoutParams(dp(112), dp(112)).apply { gravity = Gravity.CENTER_HORIZONTAL })
            addView(FirstBootUi.title(this@SetupGateActivity, "Welcome to PrimeOS", 38f))
            addView(FirstBootUi.subtitle(this@SetupGateActivity, "A fresh start for learning.", 20f))
            addView(FirstBootUi.space(this@SetupGateActivity, 24))
            addView(FirstBootUi.button(this@SetupGateActivity, "Proceed  →") {
                val next = if (BuildConfig.FIRST_BOOT_TEST_MODE && FirstBootTestStore(this@SetupGateActivity).licenceAccepted)
                    SetupWifiActivity::class.java else PrimeOsTermsActivity::class.java
                startActivity(Intent(this@SetupGateActivity, next))
            }, LinearLayout.LayoutParams(dp(390), dp(56)).apply { gravity = Gravity.CENTER_HORIZONTAL })
            addView(FirstBootUi.space(this@SetupGateActivity, 16))
            addView(FirstBootUi.subtitle(this@SetupGateActivity, "PrimeOS powered by RoboKorda Africa", 13f))
        }
        root.addView(content, FrameLayout.LayoutParams(dp(660), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        setContentView(root)
        SetupGatePolicy.configureLikeRequiredNotice(this)
    }

    private fun dp(value: Int) = FirstBootUi.dp(this, value)
}
