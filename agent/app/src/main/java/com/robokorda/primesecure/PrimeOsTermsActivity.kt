package com.robokorda.primesecure

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/** Explicit first-boot licence and school-management acknowledgement. */
class PrimeOsTermsActivity : Activity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        render()
        SetupGatePolicy.enter(this)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) SetupGatePolicy.configureLikeRequiredNotice(this)
    }

    @Deprecated("Terms must be accepted or setup returned to the welcome screen")
    override fun onBackPressed() {
        startActivity(Intent(this, SetupGateActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP))
        finish()
    }

    private fun render() {
        val content = FirstBootUi.centered(this, 820).apply {
            addView(FirstBootUi.icon(this@PrimeOsTermsActivity, R.drawable.ic_firstboot_shield, 58, "Licence and terms"))
            addView(FirstBootUi.title(this@PrimeOsTermsActivity, "PrimeOS licence & terms", 32f))
            addView(FirstBootUi.subtitle(this@PrimeOsTermsActivity, "Please read and accept before setting up this PrimeBook.", 16f))
            addView(FirstBootUi.space(this@PrimeOsTermsActivity, 16))
            val terms = TextView(this@PrimeOsTermsActivity).apply {
                text = """PrimeOS is provided for authorised learning on this school-managed PrimeBook.

• The school and RoboKorda Africa may apply security settings, approved apps, learning resources and device-management policies.
• Device and app status, school-workspace activity totals, installed-app information and location may be reported when enabled by school policy.
• PrimeSecure does not claim to record keystrokes, microphone audio, camera video or private message contents.
• Do not bypass management, hard-reset or reflash the PrimeBook. Contact the school or RoboKorda Support if access or recovery is needed.
• Keep the PrimeBook connected and protect it from loss, damage and unauthorised use.

This test build stores acceptance only on this PrimeBook. The production service will record the current published terms version with the school setup record."""
                textSize = 14f
                setTextColor(FirstBootUi.navy)
                setLineSpacing(dp(4).toFloat(), 1f)
                setPadding(dp(20), dp(16), dp(20), dp(16))
                background = FirstBootUi.rounded(this@PrimeOsTermsActivity, Color.WHITE, 18, FirstBootUi.line)
            }
            addView(ScrollView(this@PrimeOsTermsActivity).apply { addView(terms) },
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(280)))
            val accepted = CheckBox(this@PrimeOsTermsActivity).apply {
                text = "I have read and accept the PrimeOS licence and school-management terms."
                textSize = 14f
                setTextColor(FirstBootUi.navy)
                setPadding(0, dp(10), 0, dp(6))
            }
            addView(accepted)
            addView(FirstBootUi.space(this@PrimeOsTermsActivity, 8))
            addView(FirstBootUi.button(this@PrimeOsTermsActivity, "Accept and continue  →") {
                if (!accepted.isChecked) {
                    Toast.makeText(this@PrimeOsTermsActivity, "Accept the licence and terms to continue.", Toast.LENGTH_LONG).show()
                    return@button
                }
                if (BuildConfig.FIRST_BOOT_TEST_MODE) FirstBootTestStore(this@PrimeOsTermsActivity).licenceAccepted = true
                startActivity(Intent(this@PrimeOsTermsActivity, SetupWifiActivity::class.java))
                finish()
            }, LinearLayout.LayoutParams(dp(560), dp(54)).apply { gravity = Gravity.CENTER_HORIZONTAL })
            addView(FirstBootUi.space(this@PrimeOsTermsActivity, 8))
            addView(FirstBootUi.button(this@PrimeOsTermsActivity, "Back", true) { onBackPressed() },
                LinearLayout.LayoutParams(dp(560), dp(50)).apply { gravity = Gravity.CENTER_HORIZONTAL })
        }
        setContentView(FirstBootUi.screen(this, content, scroll = true))
    }

    private fun dp(value: Int) = FirstBootUi.dp(this, value)
}
