package com.robokorda.primesecure

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.*
import kotlinx.coroutines.*
import org.json.JSONObject
import java.util.Locale

/** Honest, resumable preparation UI whose stages are backed by observed setup state. */
class SetupActivity : Activity() {
    private val scope = MainScope()
    private var polling: Job? = null
    private lateinit var title: TextView
    private lateinit var subtitle: TextView
    private lateinit var hero: TextView
    private lateinit var stages: LinearLayout
    private lateinit var readyDetails: LinearLayout
    private lateinit var details: TextView
    private lateinit var open: Button
    private lateinit var media: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!AgentStore(this).isEnrolled) { startActivity(Intent(this, SetupGateActivity::class.java)); finish(); return }
        if (!InitialSetup(this).pending) { startActivity(Intent(this, HubActivity::class.java)); finish(); return }
        EnrollmentStartup.apply(this); window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); render()
        CheckInWorker.runNow(this); HubSync.schedule(this)
    }

    private fun render() {
        val content = FirstBootUi.centered(this, 820).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            hero = FirstBootUi.text(this@SetupActivity, "◌", 54f, FirstBootUi.blue, true).apply { gravity = Gravity.CENTER }
            title = FirstBootUi.title(this@SetupActivity, "Preparing your PrimeBook", 34f)
            subtitle = FirstBootUi.subtitle(this@SetupActivity, "Keep your PrimeBook on and connected.", 17f)
            addView(hero); addView(title); addView(subtitle); addView(FirstBootUi.space(this@SetupActivity, 18))
            stages = FirstBootUi.card(this@SetupActivity, 20)
            addView(stages, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            readyDetails = FirstBootUi.card(this@SetupActivity, 18).apply { visibility = View.GONE }
            addView(readyDetails, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) })
            details = FirstBootUi.text(this@SetupActivity, "", 12f, FirstBootUi.muted).apply { gravity = Gravity.CENTER; setPadding(0, dp(8), 0, 0) }
            addView(details)
            media = FirstBootUi.button(this@SetupActivity, "Allow media access", true) { requestMediaAccess() }.apply { visibility = View.GONE }
            addView(media, LinearLayout.LayoutParams(dp(520), dp(50)).apply { gravity = Gravity.CENTER_HORIZONTAL })
            open = FirstBootUi.button(this@SetupActivity, "Continue to student setup  →") { finishToDesktop() }.apply { visibility = View.GONE }
            addView(open, LinearLayout.LayoutParams(dp(570), dp(54)).apply { gravity = Gravity.CENTER_HORIZONTAL })
            addView(FirstBootUi.subtitle(this@SetupActivity, "Progress updates as each step completes.", 13f))
        }
        setContentView(FirstBootUi.screen(this, content, scroll = true))
    }

    override fun onResume() {
        super.onResume(); if (!::stages.isInitialized) return
        EnrollmentStartup.apply(this); polling?.cancel()
        polling = scope.launch {
            while (isActive) {
                runCatching { withContext(Dispatchers.IO) { snapshot() } }.onSuccess(::display)
                    .onFailure { details.text = Connectivity.message(it) }
                delay(1500)
            }
        }
    }
    override fun onPause() { polling?.cancel(); polling = null; super.onPause() }
    override fun onDestroy() { scope.cancel(); super.onDestroy() }
    @Deprecated("Preparation cannot be skipped") override fun onBackPressed() = Unit

    private data class Snapshot(val rows: List<Pair<String, Boolean>>, val ready: Boolean, val backgroundComplete: Boolean,
        val online: Boolean, val activity: String, val error: String?, val filesAllowed: Boolean,
        val school: String, val student: String)

    private fun snapshot(): Snapshot {
        val setup = InitialSetup(this); val store = AgentStore(this); val hub = HubStore(this)
        val catalog = hub.catalog; val items = hub.items(); val required = InitialSetup.requiredApps(catalog, items)
        val installed = required.count { runCatching { packageManager.getPackageInfo(it.getString("package_name"), 0) }.isSuccess }
        val noteIds = InitialSetup.starterIds(items)
        val downloaded = items.count { it.optString("id") in noteIds && hub.resourceFile(it).let { file -> file.exists() && file.length() == it.optLong("size") } }
        val wallpaper = catalog.optJSONObject("wallpaper")
        val wallpaperReady = wallpaper == null || (hub.resourceFile(wallpaper).exists() && store.appliedWallpaperUrl == "hub:" + wallpaper.optString("storage_path"))
        val filesAllowed = FileManager.hasAccess(); val owner = AdminReceiver.isDeviceOwner(this)
        val learningReady = setup.catalogReady && wallpaperReady && downloaded == noteIds.size
        val readyForDesktop = SetupRequirements.readyForDesktop(owner, store.isEnrolled, setup.policyReady, setup.catalogReady)
        val backgroundComplete = SetupRequirements.backgroundComplete(
            installed == required.size, wallpaperReady, downloaded == noteIds.size, filesAllowed,
        )
        val rows = listOf(
            "Verifying PrimeBook" to owner,
            "Applying school policy" to setup.policyReady,
            "Setting up required apps" to (installed == required.size),
            "Preparing learning resources" to learningReady,
            "Locking the PrimeBook" to (owner && setup.policyReady),
            "Ready for school" to readyForDesktop,
        )
        val tasks = HubTasks(this).all(); val active = tasks.filter { it.optString("status") !in setOf("done", "installed", "superseded") }.take(3)
        val activity = active.joinToString("\n") {
            val total = it.optLong("total"); val bytes = it.optLong("bytes")
            val amount = if (total > 0) " · ${((bytes.toDouble()/total)*100).toInt().coerceIn(0,100)}%" else ""
            val speed = it.optLong("speed").takeIf { n -> n > 0 }?.let { n -> " · " + String.format(Locale.ROOT, "%.1f KB/s", n/1024.0) } ?: ""
            "${it.optString("title")} — ${it.optString("status")}$amount$speed"
        }
        return Snapshot(rows, readyForDesktop, backgroundComplete, Connectivity.online(this), activity,
            setup.policyError ?: hub.syncError ?: store.lastError, filesAllowed,
            catalog.optString("school_name", "Your school"), catalog.optString("student_name", "Student"))
    }

    private fun display(value: Snapshot) {
        val current = value.rows.indexOfFirst { !it.second }.let { if (it < 0) value.rows.lastIndex else it }
        when {
            value.ready -> {
                hero.text = "✓"; hero.setTextColor(FirstBootUi.green); title.text = "Ready for school"
                subtitle.text = if (value.backgroundComplete) "Your PrimeBook is prepared for learning."
                    else "Apps and books will continue downloading safely in the background."
            }
            current >= 4 -> { hero.text = "♢"; title.text = "Securing your PrimeBook"; subtitle.text = "Applying the final school protections." }
            current >= 2 -> { hero.text = "⌁"; title.text = "Setting up your learning tools"; subtitle.text = "Your school apps and resources are being prepared." }
            else -> { hero.text = "◌"; title.text = "Preparing your PrimeBook"; subtitle.text = "Keep your PrimeBook on and connected." }
        }
        stages.removeAllViews()
        value.rows.forEachIndexed { index, (label, complete) ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(7), 0, dp(7)) }
            row.addView(FirstBootUi.text(this, if (complete) "✓" else if (index == current) "◌" else "○", 22f,
                if (complete) FirstBootUi.green else if (index == current) FirstBootUi.blue else Color.rgb(164, 174, 198), true), LinearLayout.LayoutParams(dp(48), dp(36)))
            row.addView(FirstBootUi.text(this, label, 16f, if (complete || index == current) FirstBootUi.navy else FirstBootUi.muted, complete || index == current), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            if (!complete && index == current) row.addView(FirstBootUi.text(this, "In progress", 12f, FirstBootUi.blue, true))
            stages.addView(row)
        }
        details.text = listOfNotNull(
            if (!value.online) "Waiting for internet — progress is saved." else null,
            value.activity.takeIf { it.isNotBlank() }, value.error,
        ).joinToString("\n")
        media.visibility = if (value.filesAllowed) View.GONE else View.VISIBLE
        open.visibility = if (value.ready) View.VISIBLE else View.GONE
        readyDetails.visibility = if (value.ready) View.VISIBLE else View.GONE
        if (value.ready) {
            readyDetails.removeAllViews()
            readyDetails.addView(readyRow("School", value.school))
            readyDetails.addView(readyRow("Student", value.student))
            readyDetails.addView(readyRow("Device", PrimeBookIdentity.displayId(this)))
            details.text = if (value.backgroundComplete) "School policy, apps and learning resources are ready."
                else "Core setup is complete. Pending apps and learning resources will resume automatically when the internet is available."
        }
    }

    private fun finishToDesktop() {
        InitialSetup(this).finish(); SchoolSetupHome.complete(this)
        CheckInWorker.runNow(this); HubSync.schedule(this); OfflineWorker.schedule(this)
        val app = applicationContext
        Handler(Looper.getMainLooper()).postDelayed({
            runCatching { app.startActivity(Intent(app, HubActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)) }
        }, 3000)
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { startActivity(home) }.onFailure { startActivity(Intent(this, HubActivity::class.java)) }
        finish()
    }

    private fun requestMediaAccess() {
        if (Build.VERSION.SDK_INT >= 30) runCatching {
            startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName")))
        }.onFailure { runCatching { startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)) }
            .onFailure { Toast.makeText(this, "Ask your school technician to grant PrimeSecure all-files access.", Toast.LENGTH_LONG).show() } }
    }

    private fun readyRow(label: String, value: String) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(5), 0, dp(5))
        addView(FirstBootUi.text(this@SetupActivity, label, 13f, FirstBootUi.muted), LinearLayout.LayoutParams(dp(150), ViewGroup.LayoutParams.WRAP_CONTENT))
        addView(FirstBootUi.text(this@SetupActivity, value, 14f, FirstBootUi.navy, true), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    }

    private fun dp(value: Int) = FirstBootUi.dp(this, value)
}
