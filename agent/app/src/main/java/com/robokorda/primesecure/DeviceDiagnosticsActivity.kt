package com.robokorda.primesecure

import android.app.Activity
import android.app.AlertDialog
import android.app.role.RoleManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.UserManager
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.FileProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Visible technician diagnostics for the V8 pilot. No arbitrary shell input is accepted. */
class DeviceDiagnosticsActivity : Activity() {
    private val scope = CoroutineScope(Job() + Dispatchers.Main)
    private lateinit var status: TextView
    private lateinit var output: TextView
    private lateinit var progress: ProgressBar
    private var reportText = ""
    private var reportFile: File? = null

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(14), dp(20), dp(20))
        }
        root.addView(text("PrimeBook technician diagnostics", 27f, true))
        root.addView(text(
            "This screen captures Android management, HOME, users, restrictions, package trust, firmware bootstrap and selected system logs. It cannot turn an app process into ADB/root and does not expose a reverse shell.",
            14f,
        ).apply { setPadding(0, dp(8), 0, dp(12)) })
        status = text("Preparing diagnostic snapshot…", 14f, true).apply { setTextColor(Color.rgb(35, 91, 178)) }
        root.addView(status)
        progress = ProgressBar(this).apply { isIndeterminate = true }
        root.addView(progress, LinearLayout.LayoutParams(dp(36), dp(36)).apply { gravity = Gravity.CENTER_HORIZONTAL })
        root.addView(button("Refresh complete snapshot") { collectReport() })
        root.addView(button("Request fixed firmware owner + HOME retry") { requestRetry() })
        root.addView(button("Request PrimeSecure as HOME through Android") { requestHome() })
        root.addView(button("Enable and open Developer Options") { openDeveloperOptions() })
        root.addView(button("Enable and open Wireless debugging") { openWirelessDebugging() })
        root.addView(button("Technician: unlock Developer Options page") { confirmUnlockDeveloperOptions() })
        root.addView(button("Open Wi-Fi settings") { startActivity(Intent(Settings.ACTION_WIFI_SETTINGS)) })
        root.addView(button("Copy report") { copyReport() })
        root.addView(button("Share report file") { shareReport() })
        root.addView(button("Back to PrimeSecure") { finish() })
        output = text("No report collected yet.", 11f).apply {
            setTextIsSelectable(true)
            typeface = android.graphics.Typeface.MONOSPACE
            setPadding(0, dp(18), 0, 0)
        }
        root.addView(output)
        setContentView(FirstBootUi.screen(this, root, scroll = true))
        collectReport()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun collectReport() {
        status.text = "Collecting fixed probes… this can take up to one minute."
        progress.visibility = android.view.View.VISIBLE
        scope.launch {
            runCatching { withContext(Dispatchers.IO) { DeviceDiagnosticCollector.collect(this@DeviceDiagnosticsActivity) } }
                .onSuccess {
                    reportText = it.text
                    reportFile = it.file
                    output.text = it.text
                    status.text = "Report ready: ${it.file.name}"
                }
                .onFailure {
                    status.text = "Collection failed: ${it.javaClass.simpleName}: ${it.message.orEmpty().take(200)}"
                }
            progress.visibility = android.view.View.GONE
        }
    }

    private fun requestRetry() {
        val nonce = System.currentTimeMillis().toString()
        val okAction = Settings.Global.putString(contentResolver, "robokorda_owner_retry_action", "owner_home")
        val okNonce = Settings.Global.putString(contentResolver, "robokorda_owner_retry_nonce", nonce)
        status.text = if (okAction && okNonce) {
            "Retry requested ($nonce). The fixed firmware monitor will validate the embedded APK, retry only PrimeSecure Device Owner/HOME, and record the exact result. Refresh in 15 seconds."
        } else "Android refused the retry request setting."
    }

    private fun requestHome() {
        if (Build.VERSION.SDK_INT < 29) {
            status.text = "HOME role requests are unsupported on this Android version."
            return
        }
        val role = getSystemService(RoleManager::class.java)
        when {
            !role.isRoleAvailable(RoleManager.ROLE_HOME) -> status.text = "Android reports the HOME role unavailable."
            role.isRoleHeld(RoleManager.ROLE_HOME) -> status.text = "PrimeSecure already holds HOME. Press Home to test it."
            else -> runCatching { startActivity(role.createRequestRoleIntent(RoleManager.ROLE_HOME)) }
                .onSuccess { status.text = "Select PrimeSecure in Android's HOME prompt." }
                .onFailure { status.text = "HOME prompt failed: ${it.javaClass.simpleName}" }
        }
    }

    private fun openDeveloperOptions() {
        clearDebuggingRestriction()
        val users = getSystemService(UserManager::class.java)
        val provisioned = Settings.Global.getInt(contentResolver, Settings.Global.DEVICE_PROVISIONED, -1)
        val restricted = users.hasUserRestriction(UserManager.DISALLOW_DEBUGGING_FEATURES)
        val wrote = runCatching {
            Settings.Global.putInt(contentResolver, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 1)
        }.getOrDefault(false)
        status.text = "Developer flag write=$wrote; device_provisioned=$provisioned; debugging_restricted=$restricted. Settings requires more than the enabled flag."
        runCatching { startActivity(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)) }
            .onFailure { status.append(" Open failed: ${it.javaClass.simpleName}") }
    }

    private fun clearDebuggingRestriction() {
        if (AdminReceiver.isDeviceOwner(this)) {
            runCatching {
                AdminReceiver.dpm(this).clearUserRestriction(
                    AdminReceiver.component(this),
                    UserManager.DISALLOW_DEBUGGING_FEATURES,
                )
            }
        }
    }

    private fun openWirelessDebugging() {
        runCatching { stopLockTask() }
        clearDebuggingRestriction()
        val writes = listOf(
            "device_provisioned" to Settings.Global.putInt(contentResolver, Settings.Global.DEVICE_PROVISIONED, 1),
            "user_setup_complete" to Settings.Secure.putInt(contentResolver, "user_setup_complete", 1),
            "developer_enabled" to Settings.Global.putInt(contentResolver, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 1),
            "adb_enabled" to Settings.Global.putInt(contentResolver, Settings.Global.ADB_ENABLED, 1),
            "adb_wifi_enabled" to Settings.Global.putInt(contentResolver, "adb_wifi_enabled", 1),
        )
        DeviceLog.record(this, "warning", "setup", "technician_wireless_debugging_enabled")
        status.text = "Technician writes: ${writes.joinToString { "${it.first}=${it.second}" }}. Use Wireless debugging pairing code or IP/port and keep this screen available."
        val wireless = Intent().setClassName(
            "com.android.settings",
            "com.android.settings.Settings\$WirelessDebuggingActivity",
        )
        runCatching { startActivity(wireless) }
            .recoverCatching { startActivity(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)) }
            .onFailure { status.append(" Open failed: ${it.javaClass.simpleName}") }
    }

    private fun confirmUnlockDeveloperOptions() {
        AlertDialog.Builder(this)
            .setTitle("Change Android setup flags for diagnostics?")
            .setMessage("First collect and save the current report. This technician action changes device_provisioned and user_setup_complete to 1, enables Developer Options, then opens Settings. It does not make PrimeSecure Device Owner.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Unlock diagnostics") { _, _ ->
                val results = listOf(
                    "device_provisioned" to Settings.Global.putInt(contentResolver, Settings.Global.DEVICE_PROVISIONED, 1),
                    "user_setup_complete" to Settings.Secure.putInt(contentResolver, "user_setup_complete", 1),
                    "developer_enabled" to Settings.Global.putInt(contentResolver, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 1),
                )
                DeviceLog.record(this, "warning", "setup", "technician_setup_flags_completed")
                status.text = "Technician setup writes: ${results.joinToString { "${it.first}=${it.second}" }}. This changed setup visibility only; Device Owner is still checked separately."
                runCatching { startActivity(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)) }
                    .onFailure { status.append(" Open failed: ${it.javaClass.simpleName}") }
            }
            .show()
    }

    private fun copyReport() {
        if (reportText.isBlank()) {
            status.text = "Collect a report first."
            return
        }
        getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("PrimeBook diagnostics", reportText))
        Toast.makeText(this, "Diagnostic report copied", Toast.LENGTH_LONG).show()
    }

    private fun shareReport() {
        val file = reportFile ?: run { status.text = "Collect a report first."; return }
        val uri: Uri = FileProvider.getUriForFile(this, "$packageName.resources", file)
        val intent = Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, "PrimeBook V8 diagnostics")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        runCatching { startActivity(Intent.createChooser(intent, "Share diagnostic report")) }
            .onFailure { status.text = "No share destination available: ${it.javaClass.simpleName}" }
    }

    private fun button(label: String, click: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        minHeight = dp(50)
        setOnClickListener { click() }
    }

    private fun text(value: String, size: Float, bold: Boolean = false) = TextView(this).apply {
        text = value
        textSize = size
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        setLineSpacing(dp(2).toFloat(), 1f)
    }

    private fun dp(value: Int) = (resources.displayMetrics.density * value).toInt()
}
