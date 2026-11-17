package com.robokorda.primesecure

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout

/** Visual end-to-end rehearsal. Stages are simulated and never claim server completion. */
class OfflineTestPreparationActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private var completeCount = 0
    private val labels = listOf(
        "Verifying PrimeBook",
        "Applying school policy",
        "Setting up required apps",
        "Preparing learning resources",
        "Locking the PrimeBook",
        "Ready for school",
    )
    private val advance = object : Runnable {
        override fun run() {
            if (completeCount < labels.size) {
                completeCount++
                render()
                if (completeCount < labels.size) handler.postDelayed(this, 850)
            }
        }
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        if (!BuildConfig.FIRST_BOOT_TEST_MODE) { finish(); return }
        render()
        handler.postDelayed(advance, 700)
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    @Deprecated("Test flow stays contained")
    override fun onBackPressed() = Unit

    private fun render() {
        if (completeCount >= labels.size) {
            renderReady()
            return
        }
        val stage = when {
            completeCount < 2 -> Triple(R.drawable.ic_firstboot_school, "Preparing your PrimeBook", "Keep your PrimeBook on and connected.")
            completeCount < 4 -> Triple(R.drawable.ic_firstboot_book, "Setting up your learning tools", "Your school apps and resources are being prepared.")
            else -> Triple(R.drawable.ic_firstboot_shield, "Securing your PrimeBook", "Applying the final school protections.")
        }
        val content = FirstBootUi.centered(this, 900).apply {
            addView(FirstBootUi.icon(this@OfflineTestPreparationActivity, stage.first, 76, null))
            addView(FirstBootUi.title(this@OfflineTestPreparationActivity, stage.second, 34f))
            addView(FirstBootUi.subtitle(this@OfflineTestPreparationActivity, stage.third, 16f))
            addView(FirstBootUi.space(this@OfflineTestPreparationActivity, 18))
            addView(progressCard(), LinearLayout.LayoutParams(dp(720), ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                gravity = Gravity.CENTER_HORIZONTAL
            })
            addView(FirstBootUi.space(this@OfflineTestPreparationActivity, 14))
            addView(FirstBootUi.subtitle(this@OfflineTestPreparationActivity,
                "Offline visual test — each stage is simulated until the setup server is available.", 13f))
        }
        setContentView(FirstBootUi.screen(this, content))
    }

    private fun progressCard() = FirstBootUi.card(this, 20).apply {
        setPadding(dp(26), dp(12), dp(26), dp(12))
        labels.forEachIndexed { index, label ->
            val done = index < completeCount
            val current = index == completeCount
            val row = LinearLayout(this@OfflineTestPreparationActivity).apply {
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(6), 0, dp(6))
                addView(ImageView(this@OfflineTestPreparationActivity).apply {
                    setImageResource(if (done) R.drawable.ic_firstboot_check else if (current) R.drawable.ic_firstboot_progress else R.drawable.ic_firstboot_pending)
                    contentDescription = if (done) "Complete" else if (current) "In progress" else "Pending"
                }, LinearLayout.LayoutParams(dp(28), dp(28)).apply { rightMargin = dp(16) })
                addView(FirstBootUi.text(this@OfflineTestPreparationActivity, label, 16f,
                    if (done || current) FirstBootUi.navy else FirstBootUi.muted, done || current),
                    LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                if (current) addView(FirstBootUi.text(this@OfflineTestPreparationActivity, "In progress", 12f, FirstBootUi.blue, true).apply {
                    setPadding(dp(12), dp(5), dp(12), dp(5))
                    background = FirstBootUi.rounded(this@OfflineTestPreparationActivity, Color.rgb(235, 237, 255), 16)
                })
            }
            addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46)))
        }
    }

    private fun renderReady() {
        val test = FirstBootTestStore(this)
        val content = FirstBootUi.centered(this, 820).apply {
            addView(FirstBootUi.icon(this@OfflineTestPreparationActivity, R.drawable.ic_firstboot_check, 82, "Setup complete"))
            addView(FirstBootUi.title(this@OfflineTestPreparationActivity, "Ready for school", 36f))
            addView(FirstBootUi.subtitle(this@OfflineTestPreparationActivity, "Your PrimeBook is prepared for learning.", 17f))
            addView(FirstBootUi.space(this@OfflineTestPreparationActivity, 14))
            addView(FirstBootUi.card(this@OfflineTestPreparationActivity, 20).apply {
                addView(detail("School", test.school))
                addView(detail("Student", test.studentName))
                addView(detail("Device", PrimeBookIdentity.displayId(this@OfflineTestPreparationActivity)))
            }, LinearLayout.LayoutParams(dp(680), ViewGroup.LayoutParams.WRAP_CONTENT).apply { gravity = Gravity.CENTER_HORIZONTAL })
            addView(FirstBootUi.space(this@OfflineTestPreparationActivity, 16))
            listOf("School policy prepared", "Apps and learning resources ready", "PrimeBook secured").forEach { item ->
                addView(LinearLayout(this@OfflineTestPreparationActivity).apply {
                    gravity = Gravity.CENTER_VERTICAL
                    addView(ImageView(this@OfflineTestPreparationActivity).apply { setImageResource(R.drawable.ic_firstboot_check) },
                        LinearLayout.LayoutParams(dp(25), dp(25)).apply { rightMargin = dp(10) })
                    addView(FirstBootUi.text(this@OfflineTestPreparationActivity, item, 15f, FirstBootUi.navy))
                }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(34)).apply { gravity = Gravity.CENTER_HORIZONTAL })
            }
            addView(FirstBootUi.space(this@OfflineTestPreparationActivity, 16))
            addView(FirstBootUi.button(this@OfflineTestPreparationActivity, "Open PrimeOS desktop  →") { openDesktop() },
                LinearLayout.LayoutParams(dp(560), dp(56)).apply { gravity = Gravity.CENTER_HORIZONTAL })
            addView(FirstBootUi.space(this@OfflineTestPreparationActivity, 8))
            addView(FirstBootUi.subtitle(this@OfflineTestPreparationActivity,
                "PrimeSecure will open the student welcome five seconds after the desktop appears.", 13f))
        }
        setContentView(FirstBootUi.screen(this, content, scroll = true))
    }

    private fun detail(label: String, value: String) = LinearLayout(this).apply {
        gravity = Gravity.CENTER_VERTICAL
        setPadding(0, dp(5), 0, dp(5))
        addView(FirstBootUi.text(this@OfflineTestPreparationActivity, label, 14f, FirstBootUi.muted),
            LinearLayout.LayoutParams(dp(150), ViewGroup.LayoutParams.WRAP_CONTENT))
        addView(FirstBootUi.text(this@OfflineTestPreparationActivity, value, 15f, FirstBootUi.navy, true),
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    }

    private fun openDesktop() {
        startActivity(Intent(this, OfflineDesktopPreviewActivity::class.java))
        finish()
    }

    private fun dp(value: Int) = FirstBootUi.dp(this, value)
}
