package com.robokorda.primesecure

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

/** School enrollment after Android-authorized management; technician extras remain supported. */
class MainActivity : Activity() {
    private val scope = MainScope()
    private lateinit var store: AgentStore
    private lateinit var status: TextView
    private lateinit var badge: TextView
    private lateinit var tokenInput: EditText
    private lateinit var counter: TextView
    private lateinit var validation: TextView
    private lateinit var managementHint: TextView
    private lateinit var enrollButton: Button
    private lateinit var checkInButton: Button
    private lateinit var provisionButton: Button
    private lateinit var progressRow: LinearLayout
    private lateinit var progressLabel: TextView
    private var busy = false
    private var attempted = false
    private var actionError: String? = null
    private val dark get() = StudentTheme.dark(this)
    private val muted get() = Color.parseColor(if (dark) "#a8b5ce" else "#66758b")
    private val accent get() = Color.parseColor(if (dark) "#a997ff" else "#5840cb")
    private val border get() = Color.parseColor(if (dark) "#35415a" else "#dce3ef")
    private val errorColor get() = Color.parseColor(if (dark) "#ffb0b0" else "#b42335")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = AgentStore(this)
        if (store.isEnrolled) {
            startActivity(InitialSetup(this).destination())
            finish()
            return
        }
        buildInterface()
        handleIntent(intent)
        refresh()
    }

    private fun buildInterface() {
        StudentTheme.applyWindow(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(20), dp(28), dp(20), dp(28))
            setBackgroundColor(StudentTheme.background(this@MainActivity))
        }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(26), dp(26), dp(26), dp(24))
            background = rounded(StudentTheme.surface(this@MainActivity), 24, border)
        }
        root.addView(card, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        val brand = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }
        brand.addView(ImageView(this).apply {
            setImageResource(R.drawable.primebook)
            contentDescription = "Primebook"
            scaleType = ImageView.ScaleType.FIT_CENTER
            setPadding(dp(14), dp(14), dp(14), dp(14))
            background = rounded(Color.WHITE, 22)
        }, LinearLayout.LayoutParams(dp(88), dp(88)))
        gap(brand, 14)
        brand.addView(label("PrimeSecure", 27f, StudentTheme.foreground(this), true).apply { gravity = Gravity.CENTER })
        gap(brand, 5)
        brand.addView(label("YOUR SCHOOL WORKSPACE", 11f, muted, true).apply {
            gravity = Gravity.CENTER
            letterSpacing = 0.12f
        })
        card.addView(brand)
        gap(card, 23)
        badge = label("Not enrolled", 12f, accent, true).apply { setPadding(dp(11), dp(7), dp(11), dp(7)) }
        card.addView(badge, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { gravity = Gravity.CENTER_HORIZONTAL })
        gap(card, 17)
        card.addView(label("Link this Primebook", 22f, StudentTheme.foreground(this), true).apply { gravity = Gravity.CENTER })
        gap(card, 8)
        card.addView(label("Enter the key shown on your school technician's PC. Keep this Primebook connected while we prepare your apps and learning materials.", 14f, muted))
        gap(card, 23)
        val keyHeading = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        keyHeading.addView(label("ENROLLMENT KEY", 11f, muted, true), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        counter = label("0 / 8", 12f, muted)
        keyHeading.addView(counter)
        card.addView(keyHeading)
        gap(card, 8)
        tokenInput = EditText(this).apply {
            hint = "XXXX-XXXX"
            contentDescription = "School enrollment key"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD or
                InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_GO
            gravity = Gravity.CENTER
            textSize = 27f
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            letterSpacing = 0.08f
            setTextColor(StudentTheme.foreground(this@MainActivity))
            setHintTextColor(if (dark) Color.parseColor("#7e8ca7") else Color.parseColor("#a0aac0"))
            setPadding(dp(14), dp(14), dp(14), dp(14))
            background = rounded(StudentTheme.background(this@MainActivity), 14, border)
            setSelectAllOnFocus(false)
            setOnEditorActionListener { _, action, event ->
                if (action == EditorInfo.IME_ACTION_GO || event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_UP) {
                    if (AdminReceiver.isDeviceOwner(this@MainActivity)) enroll(text.toString()) else requestManagement()
                    true
                } else false
            }
        }
        card.addView(tokenInput, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(68)))
        gap(card, 8)
        card.addView(label("Eight letters or numbers. Capitals and the dash are added for you.", 12f, muted))
        validation = label("", 13f, errorColor).apply {
            visibility = View.GONE
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
            setPadding(0, dp(10), 0, 0)
        }
        card.addView(validation)
        gap(card, 20)
        enrollButton = actionButton("Enroll and prepare Primebook").apply { setOnClickListener { enroll(tokenInput.text.toString()) } }
        provisionButton = actionButton("Set up device management").apply { setOnClickListener { requestManagement() } }
        card.addView(enrollButton, buttonParams())
        card.addView(provisionButton, buttonParams())
        managementHint = label("Android must authorize school management first. An enrollment key alone cannot make this app Device Owner.", 12f, muted).apply {
            setPadding(0, dp(10), 0, 0)
        }
        card.addView(managementHint)
        progressRow = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(16), 0, 0)
            visibility = View.GONE
        }
        progressRow.addView(ProgressBar(this, null, android.R.attr.progressBarStyleSmall).apply {
            isIndeterminate = true
            indeterminateTintList = ColorStateList.valueOf(accent)
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LinearLayout.LayoutParams(dp(24), dp(24)))
        progressLabel = label("", 13f, muted).apply {
            setPadding(dp(10), 0, 0, 0)
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        progressRow.addView(progressLabel, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        card.addView(progressRow)
        gap(card, 22)
        card.addView(View(this).apply { setBackgroundColor(border) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)))
        val diagnostics = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
        }
        val advanced = Button(this).apply {
            text = "Advanced diagnostics  +"
            isAllCaps = false
            textSize = 12f
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setPadding(0, dp(8), 0, dp(8))
            setTextColor(muted)
            setBackgroundColor(Color.TRANSPARENT)
            minHeight = dp(44)
            setOnClickListener {
                val show = diagnostics.visibility != View.VISIBLE
                diagnostics.visibility = if (show) View.VISIBLE else View.GONE
                text = if (show) "Advanced diagnostics  −" else "Advanced diagnostics  +"
                isSelected = show
            }
        }
        card.addView(advanced, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46)))
        status = label("", 12f, muted).apply { setTextIsSelectable(true); setLineSpacing(dp(3).toFloat(), 1f) }
        diagnostics.addView(status)
        checkInButton = actionButton("Check in now", secondary = true).apply { setOnClickListener { checkIn() } }
        diagnostics.addView(checkInButton, buttonParams().apply { topMargin = dp(12) })
        if (BuildConfig.DEBUG) {
            diagnostics.addView(actionButton("DEBUG: undo policies + release Device Owner", secondary = true).apply {
                setOnClickListener { releaseForTesting() }
            }, buttonParams().apply { topMargin = dp(8) })
        }
        card.addView(diagnostics)
        gap(root, 16)
        root.addView(label("Keep this Primebook online during setup.", 12f, muted).apply { gravity = Gravity.CENTER })
        val scroll = ScrollView(this).apply { isFillViewport = true; addView(root) }
        setContentView(scroll)
        scroll.viewTreeObserver.addOnGlobalLayoutListener {
            val width = minOf(dp(620), scroll.width - root.paddingLeft - root.paddingRight).coerceAtLeast(1)
            if (card.layoutParams.width != width) card.layoutParams = LinearLayout.LayoutParams(width, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        observeKey()
    }

    private fun observeKey() {
        tokenInput.addTextChangedListener(object : TextWatcher {
            private var applying = false
            private var change: EnrollmentKey.Change? = null
            override fun beforeTextChanged(value: CharSequence?, start: Int, count: Int, after: Int) {
                if (!applying) change = EnrollmentKey.Change(value?.toString().orEmpty(), start, count, after,
                    tokenInput.selectionStart, tokenInput.selectionEnd)
            }
            override fun onTextChanged(value: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(value: Editable?) {
                if (applying) return
                val edit = EnrollmentKey.format(value?.toString().orEmpty(), tokenInput.selectionStart,
                    tokenInput.selectionEnd, change)
                if (edit.text != value?.toString()) {
                    applying = true
                    tokenInput.setText(edit.text)
                    tokenInput.setSelection(edit.selectionStart, edit.selectionEnd)
                    applying = false
                }
                actionError = null
                updateKeyState()
            }
        })
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) {
            refresh()
            if (!busy && AdminReceiver.isDeviceOwner(this) && !store.isEnrolled) {
                Provisioning.pendingToken(this)?.takeIf { it.isNotBlank() }?.let { enroll(it) }
            }
        }
    }

    @Deprecated("Android provisioning result")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == Provisioning.REQUEST && !AdminReceiver.isDeviceOwner(this)) {
            Provisioning.clear(this)
            actionError = "Device management setup was not completed. Enrollment has not been started."
            refresh()
        }
    }

    override fun onDestroy() { scope.cancel(); super.onDestroy() }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // PrimeOS can keep both terminal and enrollment windows resumed.
        if (hasFocus && ::status.isInitialized && !busy) refresh()
    }

    private fun handleIntent(intent: Intent?) {
        intent ?: return
        intent.getStringExtra("server_url")?.takeIf { it.isNotBlank() }?.let { store.serverUrl = it }
        intent.getStringExtra("anon_key")?.takeIf { it.isNotBlank() }?.let { store.anonKey = it }
        intent.getStringExtra("token")?.takeIf { it.isNotBlank() }?.let { token ->
            tokenInput.setText(EnrollmentKey.format(token).text)
            tokenInput.setSelection(tokenInput.length())
            if (!store.isEnrolled && AdminReceiver.isDeviceOwner(this)) enroll(token)
        }
    }

    private fun validatedKey(value: String): String? {
        val canonical = EnrollmentKey.canonical(value)
        if (canonical == null) { attempted = true; updateKeyState(); tokenInput.requestFocus() }
        return canonical
    }

    private fun requestManagement() {
        if (busy) return
        val token = validatedKey(tokenInput.text.toString()) ?: return
        if (AdminReceiver.isDeviceOwner(this)) { refresh(); enroll(token); return }
        val reason = runCatching { Provisioning.unavailableReason(this) }.getOrElse { Connectivity.message(it) }
        if (reason != null) AlertDialog.Builder(this).setTitle("Device management setup")
            .setMessage(reason).setPositiveButton("OK", null).show()
        else AlertDialog.Builder(this).setTitle("Start Android management setup?")
            .setMessage("Use this only on a new or reset device with no student files. Android may factory-reset the device if provisioning fails. This flow requires Android's authorization; it cannot bypass PrimeOS setup restrictions.")
            .setNegativeButton("Cancel", null).setPositiveButton("Continue to Android setup") { _, _ ->
                runCatching { Provisioning.request(this, token) }.onFailure {
                    actionError = Connectivity.message(it); refresh()
                }
            }.show()
    }

    private fun enroll(value: String) {
        val token = validatedKey(value) ?: return
        launchTask("Enrolling… Keep this Primebook connected to the internet.") {
            CheckInWorker.enroll(this, token)
            toast("Enrolled")
        }
    }

    private fun checkIn() = launchTask("Syncing with your school…") {
        CheckInWorker.checkIn(this)
        toast("Checked in")
    }

    private fun launchTask(label: String, block: suspend () -> Unit) {
        if (busy) return
        busy = true
        actionError = null
        progressLabel.text = label
        refresh()
        scope.launch {
            try {
                block()
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                DeviceLog.event(this@MainActivity, "error", "setup", "enrollment_action_failed", e)
                actionError = Connectivity.message(e)
            } finally {
                busy = false
                refresh()
                if (store.isEnrolled && InitialSetup(this@MainActivity).pending) {
                    startActivity(InitialSetup(this@MainActivity).destination()); finish()
                }
            }
        }
    }

    private fun releaseForTesting() {
        try {
            PolicyApplier(this, store).undoAll()
            CheckInWorker.cancel(this)
            store.clearEnrollment()
            @Suppress("DEPRECATION")
            if (AdminReceiver.isDeviceOwner(this)) AdminReceiver.dpm(this).clearDeviceOwnerApp(packageName)
            toast("Released")
        } catch (e: Exception) { actionError = Connectivity.message(e) }
        refresh()
    }

    private fun updateKeyState() {
        val plain = EnrollmentKey.compact(tokenInput.text.toString())
        val problem = EnrollmentKey.problem(tokenInput.text.toString())
        val owner = AdminReceiver.isDeviceOwner(this)
        counter.text = "${plain.codePointCount(0, plain.length)} / 8"
        counter.setTextColor(if (problem == EnrollmentKey.Problem.TOO_LONG || problem == EnrollmentKey.Problem.INVALID_CHARACTER) errorColor else muted)
        val message = actionError ?: when {
            problem == EnrollmentKey.Problem.INVALID_CHARACTER -> "Use only the letters and numbers from your school key. Check any extra symbols."
            problem == EnrollmentKey.Problem.TOO_LONG -> "This key has more than 8 characters. Check it against the school dashboard."
            attempted && problem != null -> "Enter all 8 characters from your school enrollment key."
            else -> null
        }
        validation.text = message.orEmpty()
        validation.visibility = if (message == null) View.GONE else View.VISIBLE
        tokenInput.background = rounded(StudentTheme.background(this), 14, if (message != null) errorColor else if (problem == null) accent else border)
        tokenInput.isEnabled = !store.isEnrolled && !busy
        enrollButton.visibility = if (owner) View.VISIBLE else View.GONE
        enrollButton.isEnabled = !store.isEnrolled && owner && !busy && problem == null
        provisionButton.visibility = if (owner) View.GONE else View.VISIBLE
        provisionButton.isEnabled = !busy && !owner && problem == null
        managementHint.visibility = if (owner) View.GONE else View.VISIBLE
        checkInButton.visibility = if (store.isEnrolled) View.VISIBLE else View.GONE
        checkInButton.isEnabled = store.isEnrolled && !busy
        progressRow.visibility = if (busy) View.VISIBLE else View.GONE
    }

    private fun refresh() {
        val owner = AdminReceiver.isDeviceOwner(this)
        val ready = owner && !busy
        badge.text = when { busy -> "Connecting to your school"; store.isEnrolled -> "Enrolled"; owner -> "Management ready · Not enrolled"; else -> "Management setup needed" }
        badge.setTextColor(if (ready) Color.parseColor(if (dark) "#88ddbd" else "#147453") else accent)
        badge.background = rounded(Color.parseColor(if (ready) if (dark) "#183b34" else "#e6f5ed" else if (dark) "#30294c" else "#efebfc"), 20)
        val fmt = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.MEDIUM)
        status.text = buildString {
            appendLine("Device Owner: ${if (owner) "YES" else "NO"}")
            appendLine("Server: ${store.serverUrl.ifBlank { "(not set)" }}")
            appendLine("Agent: ${BuildConfig.VERSION_NAME}${if (BuildConfig.DEBUG) " (debug)" else ""}")
            appendLine("All-files access: ${if (FileManager.hasAccess()) "yes" else "not granted"}")
            if (store.isEnrolled) {
                appendLine("Device ID: ${store.deviceId}")
                appendLine("Status: ${store.lastStatus ?: "—"}")
                appendLine("Last check-in: ${store.lastCheckInAt.takeIf { it > 0 }?.let { fmt.format(Date(it)) } ?: "never"}")
                store.lastPolicySummary?.let { appendLine(it) }
            } else if (!owner) {
                appendLine()
                appendLine(runCatching { Provisioning.unavailableReason(this@MainActivity) }.getOrNull()
                    ?: "Enter your key, then ask Android to authorize school management using Set up device management.")
            }
            store.updateError?.let { appendLine().append("Agent update: ").append(it) }
            store.lastError?.let { appendLine().append("Last error: ").append(it) }
        }
        updateKeyState()
    }

    private fun label(value: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = value; textSize = size; setTextColor(color)
        typeface = Typeface.create(if (bold) "sans-serif-medium" else "sans-serif", Typeface.NORMAL)
        setLineSpacing(dp(2).toFloat(), 1f)
    }

    private fun actionButton(value: String, secondary: Boolean = false) = Button(this).apply {
        text = value; textSize = 14f; isAllCaps = false
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        minHeight = dp(48); stateListAnimator = null
        setPadding(dp(14), dp(6), dp(14), dp(6))
        background = rounded(if (secondary) StudentTheme.background(this@MainActivity) else accent, 13)
        backgroundTintList = ColorStateList(arrayOf(intArrayOf(android.R.attr.state_enabled), intArrayOf()),
            intArrayOf(if (secondary) StudentTheme.background(this@MainActivity) else accent, Color.parseColor(if (dark) "#303a50" else "#e6e9f1")))
        setTextColor(ColorStateList(arrayOf(intArrayOf(android.R.attr.state_enabled), intArrayOf()),
            intArrayOf(if (secondary) StudentTheme.foreground(this@MainActivity) else if (dark) Color.parseColor("#18132f") else Color.WHITE, muted)))
    }

    private fun rounded(fill: Int, radius: Int, stroke: Int? = null) = GradientDrawable().apply {
        cornerRadius = dp(radius).toFloat(); setColor(fill); if (stroke != null) setStroke(dp(1), stroke)
    }
    private fun buttonParams() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50))
    private fun gap(parent: LinearLayout, size: Int) { parent.addView(View(this), LinearLayout.LayoutParams(1, dp(size))) }
    private fun dp(value: Int) = (resources.displayMetrics.density * value).toInt()
    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()
}
