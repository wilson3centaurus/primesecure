package com.robokorda.primesecure

import android.app.Activity
import android.app.WallpaperManager
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.provider.Settings
import android.view.KeyEvent
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Minimal school HOME: setup gate before enrollment, two safe destinations after it. */
class SchoolLauncherActivity : Activity() {
    private val navy = Color.rgb(17, 41, 91)
    private val blue = Color.rgb(45, 112, 238)
    private val muted = Color.rgb(89, 105, 133)

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        SchoolSetupHome.reconcile(this)
        if (!SetupGatePolicy.setupComplete(this)) {
            showMandatorySetup("home_created")
            return
        }
        render()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // The firmware may assign Device Owner after this singleTask activity
        // was first created. Reconcile again when the bootstrap relaunches it.
        SchoolSetupHome.reconcile(this)
        if (!SetupGatePolicy.setupComplete(this)) {
            showMandatorySetup("home_intent")
            return
        }
        render()
    }

    override fun onResume() {
        super.onResume()
        // This also repairs HOME after a process restart or an OEM launcher
        // temporarily wins resolution while setup is incomplete.
        SchoolSetupHome.reconcile(this)
        if (!SetupGatePolicy.setupComplete(this)) {
            showMandatorySetup("home_resumed")
            return
        }
        render()
        window.decorView.post {
            SetupGatePolicy.reconcileAfterEnrollment(this)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applySetupChrome()
    }

    @Deprecated("HOME remains on the school setup gate")
    override fun onBackPressed() {
        if (!SetupGatePolicy.setupComplete(this)) render()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_UP &&
            event.keyCode in setOf(KeyEvent.KEYCODE_META_LEFT, KeyEvent.KEYCODE_META_RIGHT, KeyEvent.KEYCODE_HOME)) {
            render()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun render() {
        if (SetupGatePolicy.setupComplete(this)) {
            renderDesktop()
            return
        }
        val store = AgentStore(this)
        val enrolled = store.isEnrolled
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(34), dp(24), dp(34), dp(30))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.rgb(239, 247, 255), Color.WHITE, Color.rgb(222, 237, 255)))
        }
        val top = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        top.addView(ImageView(this).apply {
            setImageResource(R.drawable.primebook)
            contentDescription = "PrimeOS"
            scaleType = ImageView.ScaleType.FIT_CENTER
        }, LinearLayout.LayoutParams(dp(54), dp(54)))
        top.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(text("PrimeOS", 22f, navy, true))
            addView(text("powered by RoboKorda Africa", 12f, muted))
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { leftMargin = dp(12) })
        val managed = AdminReceiver.isDeviceOwner(this)
        top.addView(text(if (managed) "MANAGED" else "SETUP REQUIRED", 11f,
            if (managed) Color.rgb(16, 116, 77) else Color.rgb(178, 83, 35), true).apply {
            gravity = Gravity.CENTER
            setPadding(dp(13), dp(8), dp(13), dp(8))
            background = rounded(
                if (managed) Color.rgb(226, 247, 237) else Color.rgb(255, 239, 222),
                20,
            )
        })
        top.addView(text(WifiInventory.primeId(this)?.let { "Prime ID\n$it" } ?: "Prime ID\nPending", 11f, muted).apply {
            gravity = Gravity.END
            setTextIsSelectable(true)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            leftMargin = dp(16)
        })
        root.addView(top, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(View(this), LinearLayout.LayoutParams(1, dp(34)))

        if (!enrolled) renderSetup(root) else renderHome(root, store)
        setContentView(ScrollView(this).apply { isFillViewport = true; addView(root) })
        applySetupChrome()
    }

    /**
     * The managed HOME after setup. It is a real HOME surface using the current
     * system wallpaper and the normal PrimeOS taskbar, not the old blue preview.
     * Keeping this component as HOME also avoids the vendor Quickstep crash on
     * this image (its APK is missing android.permission.INPUT_CONSUMER).
     */
    private fun renderDesktop() {
        SetupGatePolicy.leaveSetupFullscreen(this)

        val root = FrameLayout(this).apply {
            background = runCatching { WallpaperManager.getInstance(this@SchoolLauncherActivity).drawable }
                .getOrElse {
                    GradientDrawable(GradientDrawable.Orientation.TL_BR,
                        intArrayOf(Color.rgb(29, 60, 139), Color.rgb(52, 91, 210)))
                }
        }
        root.addView(View(this).apply { setBackgroundColor(Color.argb(24, 0, 0, 0)) },
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        val shortcut = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            contentDescription = "PrimeSecure pinned on the desktop"
            setPadding(dp(8), dp(8), dp(8), dp(8))
            addView(ImageView(this@SchoolLauncherActivity).apply {
                setImageResource(R.drawable.primebook_transparent)
                scaleType = ImageView.ScaleType.FIT_CENTER
                contentDescription = "PrimeSecure"
            }, LinearLayout.LayoutParams(dp(86), dp(86)))
            addView(text("PrimeSecure", 15f, Color.WHITE, true).apply {
                gravity = Gravity.CENTER
                setShadowLayer(4f, 0f, 2f, Color.BLACK)
            }, LinearLayout.LayoutParams(dp(150), ViewGroup.LayoutParams.WRAP_CONTENT))
            setOnClickListener {
                startActivity(Intent(this@SchoolLauncherActivity, HubActivity::class.java)
                    .putExtra("offline_first_boot_welcome", SetupGatePolicy.offlineTestComplete(this@SchoolLauncherActivity)))
            }
        }
        root.addView(shortcut, FrameLayout.LayoutParams(dp(166), dp(142), Gravity.TOP or Gravity.START).apply {
            leftMargin = dp(42)
            topMargin = dp(38)
        })

        root.addView(text(
            WifiInventory.primeId(this)?.let { "Prime ID  $it" } ?: "Prime ID  Pending",
            12f,
            Color.WHITE,
            true,
        ).apply {
            gravity = Gravity.END
            setTextIsSelectable(true)
            setShadowLayer(5f, 0f, 2f, Color.BLACK)
            contentDescription = "Prime ID"
        }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM or Gravity.END).apply {
            rightMargin = dp(26)
            bottomMargin = dp(62)
        })

        setContentView(root)
    }

    private fun renderSetup(root: LinearLayout) {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(34), dp(30), dp(34), dp(30))
            background = rounded(Color.argb(235, 255, 255, 255), 28, Color.rgb(194, 218, 249))
        }
        card.addView(text("Welcome to your school PrimeBook", 29f, navy, true).apply { gravity = Gravity.CENTER })
        card.addView(space(10))
        card.addView(text("We will connect this PrimeBook, verify its school record, and prepare it for learning.", 16f, muted).apply { gravity = Gravity.CENTER })
        card.addView(space(12))
        card.addView(text("Firmware management: ${OwnerBootstrapStatus.read(this)}", 12f, muted).apply {
            gravity = Gravity.CENTER
            setTextIsSelectable(true)
        })
        card.addView(space(24))
        card.addView(action("Proceed") { openSetupWifi() })
        card.addView(space(10))
        card.addView(action("Technician diagnostics / Wireless debugging") {
            runCatching { stopLockTask() }
            startActivity(Intent(this, DeviceDiagnosticsActivity::class.java))
        })
        card.addView(space(14))
        card.addView(text("Setup cannot be skipped or closed. USB storage, Bluetooth sharing and app sideloading stay blocked while this PrimeBook is being prepared.", 12f, muted).apply { gravity = Gravity.CENTER })
        root.addView(card, LinearLayout.LayoutParams(minOf(dp(720), resources.displayMetrics.widthPixels - dp(68)), ViewGroup.LayoutParams.WRAP_CONTENT))
    }

    private fun renderHome(root: LinearLayout, store: AgentStore) {
        root.gravity = Gravity.CENTER_HORIZONTAL
        root.addView(space(24))
        root.addView(text("Welcome${studentName()?.let { ", $it" } ?: ""}", 34f, navy, true).apply { gravity = Gravity.CENTER })
        root.addView(text("PrimeOS powered by RoboKorda", 15f, muted).apply { gravity = Gravity.CENTER })
        root.addView(space(18))
        root.addView(text("Your learning workspace is ready. School downloads continue safely in the background.", 15f, muted).apply { gravity = Gravity.CENTER })
        root.addView(space(22))
        root.addView(text("Managed desktop", 13f, blue, true).apply {
            gravity = Gravity.CENTER
            setPadding(dp(14), dp(8), dp(14), dp(8))
            background = rounded(Color.rgb(230, 240, 255), 20)
        })
        root.addView(View(this), LinearLayout.LayoutParams(1, 0, 1f))
        root.addView(text("PINNED SCHOOL APPS", 11f, muted, true).apply {
            letterSpacing = .12f
            gravity = Gravity.CENTER
        })
        root.addView(space(10))
        val dock = LinearLayout(this).apply {
            gravity = Gravity.CENTER
            weightSum = 2f
            setPadding(dp(18), dp(16), dp(18), dp(16))
            background = rounded(Color.argb(224, 255, 255, 255), 28, Color.rgb(184, 211, 246))
        }
        dock.addView(tile("PrimeSecure", "Pinned school hub", R.drawable.robokorda) {
            startActivity(InitialSetup(this).destination())
        }, LinearLayout.LayoutParams(0, dp(146), 1f).apply { rightMargin = dp(9) })
        dock.addView(tile("Wi-Fi", "Connect without opening Settings", android.R.drawable.ic_menu_search) {
            startActivity(Intent(this, SetupWifiActivity::class.java))
        }, LinearLayout.LayoutParams(0, dp(146), 1f).apply { leftMargin = dp(9) })
        root.addView(dock, LinearLayout.LayoutParams(minOf(dp(610), resources.displayMetrics.widthPixels - dp(68)), dp(178)))
        root.addView(space(12))
        root.addView(text("Status: ${store.lastStatus ?: "connecting"}  •  PrimeSecure ${BuildConfig.VERSION_NAME}", 12f, muted))
    }

    private fun studentName(): String? = HubStore(this).catalog.optString("student_name").trim().takeIf { it.isNotEmpty() }

    private fun openSetupWifi() {
        startActivity(Intent(this, SetupWifiActivity::class.java))
    }

    private fun showMandatorySetup(reason: String) {
        // Do not render the retired V8 gate underneath the current wizard.  It
        // caused the old Managed/Prime ID page to appear whenever the wizard
        // task was closed or briefly lost focus.
        setContentView(View(this).apply {
            setBackgroundColor(Color.rgb(5, 17, 45))
            contentDescription = "PrimeOS setup is opening"
        })
        SetupGatePolicy.enter(this)
        SetupGatePolicy.record(this, "home_gate:$reason")
        SetupGatePolicy.launchGate(this, reason)
    }

    private fun applySetupChrome() {
        if (SetupGatePolicy.setupComplete(this)) {
            SetupGatePolicy.leaveSetupFullscreen(this)
        } else {
            SetupGatePolicy.forceFullscreen(this)
        }
    }

    private fun tile(title: String, subtitle: String, icon: Int, click: () -> Unit) = Button(this).apply {
        text = "$title\n\n$subtitle"
        textSize = 17f
        isAllCaps = false
        gravity = Gravity.CENTER
        setTextColor(navy)
        compoundDrawablePadding = dp(14)
        setCompoundDrawablesWithIntrinsicBounds(0, icon, 0, 0)
        background = rounded(Color.WHITE, 24, Color.rgb(198, 219, 247))
        stateListAnimator = null
        setOnClickListener { click() }
    }

    private fun action(label: String, click: () -> Unit) = Button(this).apply {
        text = label; textSize = 15f; isAllCaps = false
        setTextColor(Color.WHITE); minHeight = dp(50); stateListAnimator = null
        backgroundTintList = ColorStateList.valueOf(blue)
        background = rounded(blue, 14)
        setOnClickListener { click() }
    }

    private fun text(value: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = value; textSize = size; setTextColor(color)
        typeface = Typeface.create(if (bold) "sans-serif-medium" else "sans-serif", Typeface.NORMAL)
        setLineSpacing(dp(2).toFloat(), 1f)
    }
    private fun space(size: Int) = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(size)) }
    private fun rounded(fill: Int, radius: Int, stroke: Int? = null) = GradientDrawable().apply {
        cornerRadius = dp(radius).toFloat(); setColor(fill); if (stroke != null) setStroke(dp(1), stroke)
    }
    private fun dp(value: Int) = (resources.displayMetrics.density * value).toInt()
}
