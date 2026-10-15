package com.robokorda.primesecure

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.*
import kotlinx.coroutines.*
import java.util.Locale

/** Honest, resumable first-sync UI. Does not use lock task or appear over Android's login screen. */
class SetupActivity : Activity() {
    private val scope = MainScope()
    private var polling: Job? = null
    private lateinit var title: TextView
    private lateinit var status: TextView
    private lateinit var details: TextView
    private lateinit var stages: LinearLayout
    private lateinit var progress: ProgressBar
    private lateinit var open: Button
    private lateinit var media: Button
    private val purple = Color.rgb(79, 56, 196)

    private fun label(value: String, size: Float = 16f, bold: Boolean = false) = TextView(this).apply {
        text = value; textSize = size; setTextColor(Color.rgb(30, 38, 65))
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setPadding(0, 10, 0, 10)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!AgentStore(this).isEnrolled) { startActivity(Intent(this, MainActivity::class.java)); finish(); return }
        if (!InitialSetup(this).pending) { startActivity(Intent(this, HubActivity::class.java)); finish(); return }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(40, 30, 40, 30)
            setBackgroundColor(Color.rgb(244, 245, 253))
        }
        root.addView(label("PRIMESECURE  /  SCHOOL SETUP", 14f, true).apply { setTextColor(purple) })
        title = label("Preparing your Primebook", 30f, true); root.addView(title)
        root.addView(label("Keep your Primebook connected to the internet and plugged in while your school workspace is prepared."))
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(28, 20, 28, 20)
            background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = 24f }
        }
        status = label("Checking setup…", 18f, true); card.addView(status)
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 7 }
        card.addView(progress, LinearLayout.LayoutParams(-1, 14))
        stages = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; card.addView(stages)
        details = label("", 14f); card.addView(details)
        root.addView(card)
        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        buttons.addView(Button(this).apply { text = "Retry setup"; setOnClickListener { retry() } })
        buttons.addView(Button(this).apply { text = "Wi-Fi settings"; setOnClickListener {
            runCatching { startActivity(Intent(Settings.ACTION_WIFI_SETTINGS)) }.onFailure { toast("Open Wi-Fi from your Primebook's system controls.") }
        } })
        media = Button(this).apply { text = "Allow media access"; setOnClickListener { requestMediaAccess() } }; buttons.addView(media)
        root.addView(buttons)
        open = Button(this).apply {
            text = "Open PrimeSecure"; isEnabled = false
            setOnClickListener {
                scope.launch {
                    val snapshot = withContext(Dispatchers.IO) { snapshot() }
                    if (snapshot.ready) {
                        withContext(Dispatchers.IO) { InitialSetup(this@SetupActivity).finish() }
                        startActivity(Intent(this@SetupActivity, HubActivity::class.java)); finish()
                    } else toast("Setup still has work to finish. Keep the internet connected.")
                }
            }
        }; root.addView(open)
        root.addView(label("Your first notes are prepared here. The remaining school library continues downloading in Background tasks. You can leave this app; unfinished preparation resumes when you return.", 13f))
        setContentView(ScrollView(this).apply { addView(root) })
        CheckInWorker.runNow(this); HubSync.schedule(this)
    }

    override fun onResume() {
        super.onResume()
        if (!::stages.isInitialized) return
        polling?.cancel()
        polling = scope.launch {
            while (isActive) {
                runCatching { withContext(Dispatchers.IO) { snapshot() } }.onSuccess(::display)
                    .onFailure { status.text = Connectivity.message(it) }
                delay(1500)
            }
        }
    }
    override fun onPause() { polling?.cancel(); polling = null; super.onPause() }
    override fun onDestroy() { scope.cancel(); super.onDestroy() }
    @Deprecated("First setup remains visible until completed")
    override fun onBackPressed() { toast("Setup will resume when you reopen PrimeSecure. You can use the Home key to leave it.") }

    private data class Snapshot(val rows: List<Pair<String, Boolean>>, val ready: Boolean,
        val online: Boolean, val activity: String, val error: String?, val filesAllowed: Boolean)

    private fun snapshot(): Snapshot {
        val setup = InitialSetup(this); val store = AgentStore(this); val hub = HubStore(this)
        val catalog = hub.catalog; val items = hub.items()
        val required = InitialSetup.requiredApps(catalog, items)
        val installed = required.count { runCatching { packageManager.getPackageInfo(it.getString("package_name"), 0) }.isSuccess }
        val noteIds = InitialSetup.starterIds(items)
        val downloaded = items.count { it.optString("id") in noteIds && hub.resourceFile(it).let { file -> file.exists() && file.length() == it.optLong("size") } }
        val wallpaper = catalog.optJSONObject("wallpaper")
        val wallpaperReady = wallpaper == null || (hub.resourceFile(wallpaper).exists() && store.appliedWallpaperUrl == "hub:" + wallpaper.optString("storage_path"))
        val filesAllowed = FileManager.hasAccess(); val owner = AdminReceiver.isDeviceOwner(this)
        val rows = listOf("Device management active" to owner, "School policy applied" to setup.policyReady,
            "School library received" to setup.catalogReady, "Required apps: $installed / ${required.size}" to (installed == required.size),
            "School wallpaper" to wallpaperReady, "First learning resources: $downloaded / ${noteIds.size}" to (downloaded == noteIds.size),
            "Media and document access" to filesAllowed)
        val tasks = HubTasks(this).all()
        val active = tasks.filter { it.optString("status") !in setOf("done", "installed", "superseded") }.take(5)
        val activity = active.joinToString("\n") {
            val total = it.optLong("total"); val bytes = it.optLong("bytes")
            val amount = if (total > 0) " · ${((bytes.toDouble()/total)*100).toInt().coerceIn(0,100)}%" else ""
            val speed = it.optLong("speed").takeIf { n -> n > 0 }?.let { n -> " · " + String.format(Locale.ROOT, "%.1f KB/s", n/1024.0) } ?: ""
            "${it.optString("title")} — ${it.optString("status")}$amount$speed"
        }
        val ready = SetupRequirements.ready(owner, store.isEnrolled, setup.policyReady, setup.catalogReady,
            installed == required.size, wallpaperReady, downloaded == noteIds.size, filesAllowed)
        return Snapshot(rows, ready, Connectivity.online(this), activity,
            setup.policyError ?: hub.syncError ?: store.lastError, filesAllowed)
    }
    private fun display(value: Snapshot) {
        title.text = if (value.ready) "Your Primebook is ready" else "Preparing your Primebook"
        status.text = when { value.ready -> "Setup complete"; !value.online -> "Waiting for internet — progress is saved"; else -> "Updating your school workspace…" }
        progress.progress = value.rows.count { it.second }
        stages.removeAllViews()
        for ((text, complete) in value.rows) stages.addView(label("${if (complete) "✓" else "○"}  $text", 16f).apply {
            setTextColor(if (complete) Color.rgb(15, 125, 86) else Color.rgb(82, 91, 115))
        })
        details.text = listOfNotNull(value.activity.takeIf { it.isNotBlank() }, value.error).joinToString("\n\n")
        open.isEnabled = value.ready
        media.visibility = if (value.filesAllowed) View.GONE else View.VISIBLE
    }
    private fun retry() {
        scope.launch {
            withContext(Dispatchers.IO) {
                HubTasks(this@SetupActivity).apply { all().filter { it.optString("status") == "failed" && it.optString("action") == "install" }.forEach { retry(it.getString("id")) } }
                CheckInWorker.runNow(this@SetupActivity); HubSync.schedule(this@SetupActivity); OfflineWorker.schedule(this@SetupActivity)
            }
        }
    }
    private fun requestMediaAccess() {
        if (Build.VERSION.SDK_INT >= 30) runCatching {
            startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName")))
        }.onFailure { runCatching { startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)) }
            .onFailure { toast("Ask your school technician to grant PrimeSecure all-files access.") } }
    }
    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_LONG).show()
}
