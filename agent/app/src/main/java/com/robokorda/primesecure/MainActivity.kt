package com.robokorda.primesecure

import android.app.Activity
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
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = AgentStore(this)

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
        enrollButton = Button(this).apply {
            text = "Enroll"
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
        refresh()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun handleIntent(intent: Intent?) {
        intent ?: return
        intent.getStringExtra("server_url")?.takeIf { it.isNotBlank() }?.let { store.serverUrl = it }
        intent.getStringExtra("anon_key")?.takeIf { it.isNotBlank() }?.let { store.anonKey = it }
        intent.getStringExtra("token")?.takeIf { it.isNotBlank() }?.let { token ->
            tokenInput.setText(token)
            if (!store.isEnrolled) enroll(token)
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
                toast("Failed: ${e.message}")
            } finally {
                busy = false
                refresh()
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
            toast("Failed: ${e.message}")
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
                    appendLine("adb shell dpm set-device-owner $packageName/.AdminReceiver")
                }
            }
            store.lastError?.let { appendLine().append("Last error: ").append(it) }
        }
        tokenInput.isEnabled = !store.isEnrolled
        enrollButton.isEnabled = !store.isEnrolled && owner
        checkInButton.isEnabled = store.isEnrolled
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
}
