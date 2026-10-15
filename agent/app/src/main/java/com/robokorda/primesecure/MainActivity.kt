package com.robokorda.primesecure

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

/**
 * Status + enrollment screen. Enrollment is normally driven over adb right
 * after set-device-owner:
 *
 *   adb shell am start -n com.robokorda.primesecure/.MainActivity --es token K7QF-M2XP
 *
 * Optional extras server_url / anon_key override the values baked into the build.
 */
class MainActivity : Activity() {

    private val scope = MainScope()
    private lateinit var store: AgentStore
    private lateinit var status: TextView
    private lateinit var tokenInput: EditText
    private lateinit var enrollButton: Button
    private lateinit var checkInButton: Button
    private lateinit var provisionButton: Button
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = AgentStore(this)
        if (store.isEnrolled) {
            startActivity(InitialSetup(this).destination())
            finish()
            return
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
        }
        root.addView(TextView(this).apply {
            text = "PrimeSecure"
            textSize = 24f
        })
        status = TextView(this).apply {
            textSize = 15f
            setPadding(0, 24, 0, 32)
            setTextIsSelectable(true)
        }
        root.addView(status)

        tokenInput = EditText(this).apply {
            hint = "Enroll token (e.g. K7QF-M2XP)"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
        }
        root.addView(tokenInput)
        provisionButton = Button(this).apply {
            text = "Set up device management"
            setOnClickListener {
                val token = tokenInput.text.toString().trim()
                if (AdminReceiver.isDeviceOwner(this@MainActivity)) {
                    refresh()
                    if (token.isNotBlank()) enroll(token)
                    return@setOnClickListener
                }
                if (token.isBlank()) toast("Enter the enrollment key first")
                else {
                    val reason = runCatching { Provisioning.unavailableReason(this@MainActivity) }
                        .getOrElse { Connectivity.message(it) }
                    if (reason != null) AlertDialog.Builder(this@MainActivity).setTitle("Device management setup")
                        .setMessage(reason).setPositiveButton("OK", null).show()
                    else AlertDialog.Builder(this@MainActivity).setTitle("Start Android management setup?")
                        .setMessage("Use this only on a new or reset device with no student files. Android may factory-reset the device if provisioning fails. This flow requires Android's authorization; it cannot bypass PrimeOS setup restrictions.")
                        .setNegativeButton("Cancel", null).setPositiveButton("Continue to Android setup") { _, _ ->
                            runCatching { Provisioning.request(this@MainActivity, token) }
                                .onFailure { toast(Connectivity.message(it)); refresh() }
                        }.show()
                }
            }
        }
        root.addView(provisionButton)
        enrollButton = Button(this).apply {
            text = "Enroll and prepare Primebook"
            setOnClickListener { enroll(tokenInput.text.toString()) }
        }
        root.addView(enrollButton)
        checkInButton = Button(this).apply {
            text = "Check in now"
            setOnClickListener { checkIn() }
        }
        root.addView(checkInButton)

        if (BuildConfig.DEBUG) {
            root.addView(Button(this).apply {
                text = "DEBUG: undo policies + release Device Owner"
                setOnClickListener { releaseForTesting() }
            })
        }

        setContentView(ScrollView(this).apply { addView(root) })
        handleIntent(intent)
        refresh()
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
            toast("Device management setup was not completed. Enrollment has not been started.")
            refresh()
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

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
            tokenInput.setText(token)
            if (!store.isEnrolled && AdminReceiver.isDeviceOwner(this)) enroll(token)
        }
    }

    private fun enroll(token: String) {
        if (token.isBlank()) return toast("Enter the enroll token from the dashboard")
        launchTask("Enrolling…") {
            CheckInWorker.enroll(this, token)
            toast("Enrolled")
        }
    }

    private fun checkIn() = launchTask("Checking in…") {
        CheckInWorker.checkIn(this)
        toast("Checked in")
    }

    private fun launchTask(label: String, block: suspend () -> Unit) {
        if (busy) return
        busy = true
        status.text = label
        scope.launch {
            try {
                block()
            } catch (e: Exception) {
                toast(Connectivity.message(e))
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
        } catch (e: Exception) {
            toast(Connectivity.message(e))
        }
        refresh()
    }

    private fun refresh() {
        val owner = AdminReceiver.isDeviceOwner(this)
        val fmt = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.MEDIUM)
        status.text = buildString {
            appendLine("Device Owner: ${if (owner) "YES" else "NO"}")
            appendLine("Server: ${store.serverUrl.ifBlank { "(not set)" }}")
            appendLine("Agent: ${BuildConfig.VERSION_NAME}${if (BuildConfig.DEBUG) " (debug)" else ""}")
            appendLine("All-files access: ${if (FileManager.hasAccess()) "yes" else "NO (file push/browse won't work)"}")
            if (store.isEnrolled) {
                appendLine("Device ID: ${store.deviceId}")
                appendLine("Status: ${store.lastStatus ?: "—"}")
                appendLine("Last check-in: ${store.lastCheckInAt.takeIf { it > 0 }?.let { fmt.format(Date(it)) } ?: "never"}")
                store.lastPolicySummary?.let { appendLine(it) }
            } else {
                appendLine("Not enrolled")
                if (!owner) {
                    appendLine()
                    appendLine(runCatching { Provisioning.unavailableReason(this@MainActivity) }.getOrNull()
                        ?: "Enter your key, then select Set up device management to ask Android to authorize school management.")
                    appendLine("Your school's enrollment key does not by itself grant Device Owner permission.")
                }
            }
            store.updateError?.let { appendLine().append("Agent update: ").append(it) }
            store.lastError?.let { appendLine().append("Last error: ").append(it) }
        }
        tokenInput.isEnabled = !store.isEnrolled && !busy
        provisionButton.visibility = if (owner) android.view.View.GONE else android.view.View.VISIBLE
        provisionButton.isEnabled = !busy && !owner
        enrollButton.isEnabled = !store.isEnrolled && owner && !busy
        checkInButton.isEnabled = store.isEnrolled && !busy
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
}
