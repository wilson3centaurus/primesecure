package com.robokorda.primesecure

import android.app.Activity
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.Color
import android.os.Bundle
import android.widget.*
import androidx.core.content.FileProvider
import kotlinx.coroutines.*
import org.json.JSONObject

/** Always available student surface. The management screen has no launcher entry. */
class HubActivity : Activity() {
    private val scope = MainScope()
    private lateinit var hub: HubStore
    private lateinit var content: LinearLayout
    private var tab = "Messages"
    private var form: String? = null
    private var subject: String? = null
    private var category: String? = null
    private var showHidden = false
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        hub = HubStore(this)
        if (!AgentStore(this).isEnrolled) { startActivity(Intent(this, MainActivity::class.java)); finish(); return }
        HubSync.schedule(this)
        render()
    }
    override fun onResume() {
        super.onResume()
        if (::hub.isInitialized) {
            if (AgentStore(this).lastStatus == "locked") { startActivity(LockActivity.intent(this)); return }
            MessageActivity.showPending(this)
            render()
        }
    }
    override fun onDestroy() { scope.cancel(); super.onDestroy() }
    private fun text(value: String, size: Float = 16f) = TextView(this).apply {
        text = value; textSize = size; setTextColor(Color.rgb(28, 39, 71)); setPadding(8, 12, 8, 12)
    }
    private fun button(label: String, action: () -> Unit) = Button(this).apply { text = label; setOnClickListener { action() } }
    private fun render() {
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(28, 24, 28, 24); setBackgroundColor(Color.rgb(244, 247, 253)) }
        root.addView(text("PrimeSecure  /  Your school, connected", 26f))
        root.addView(text(hub.catalog.optString("student_name", "Welcome") + "  •  RoboKorda × Primebook"))
        val tabs = LinearLayout(this)
        listOf("Messages", "School Notes", "Approved Apps", "Wallpapers").forEach { name ->
            tabs.addView(button(if (tab == name) "• $name" else name) { tab = name; render() }, LinearLayout.LayoutParams(0, -2, 1f))
        }
        root.addView(tabs)
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(ScrollView(this).apply { addView(content) }, LinearLayout.LayoutParams(-1, 0, 1f))
        when (tab) { "Messages" -> messages(); "School Notes" -> notes(); "Approved Apps" -> apps(); else -> wallpapers() }
        hub.syncError?.let { content.addView(text("Sync: $it")) }
        val footer = LinearLayout(this)
        footer.addView(button("Sync now") { HubSync.schedule(this); CheckInWorker.runNow(this); toast("Sync requested. Downloads continue while online.") })
        footer.addView(button("Pin PrimeSecure") {
            val shortcuts = getSystemService(ShortcutManager::class.java)
            if (shortcuts.isRequestPinShortcutSupported) shortcuts.requestPinShortcut(ShortcutInfo.Builder(this, "student-hub")
                .setShortLabel("PrimeSecure").setIntent(Intent(this, HubActivity::class.java).setAction(Intent.ACTION_VIEW)).build(), null)
            else toast("This launcher does not support pinned shortcuts.")
        })
        root.addView(footer)
        setContentView(root)
    }
    private fun messages() {
        content.addView(text("Your school inbox", 22f))
        if (hub.messages().isEmpty()) content.addView(text("Messages from your school will appear here and remain available after acknowledgement."))
        hub.messages().forEach { m ->
            val p = m.getJSONObject("payload")
            val row = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(16, 12, 16, 20); setBackgroundColor(Color.WHITE) }
            row.addView(text(p.optString("title", "Message from school"), 20f))
            row.addView(text("${m.optString("created_at")} • ${if (m.optBoolean("acknowledged")) "Acknowledged" else "Unread"}"))
            row.addView(text(p.optString("body").take(180)))
            row.addView(button("Read message") { startActivity(MessageActivity.intent(this, m.getString("id"), p.optString("title"), p.optString("body"), p.optString("from"))) })
            content.addView(row)
        }
    }
    private fun hideControl(key: String) = button(if (hub.hidden(key)) "Show" else "Hide") { hub.hide(key, !hub.hidden(key)); render() }
    private fun notes() {
        content.addView(text("School Notes", 22f))
        content.addView(text("Resources download automatically while online. Hiding keeps your copy and can be undone."))
        content.addView(button(if (showHidden) "Hide hidden items" else "Show hidden items") { showHidden = !showHidden; render() })
        content.addView(button(listOfNotNull("All forms", form, subject, category).joinToString(" / ")) {
            when { category != null -> category = null; subject != null -> subject = null; else -> form = null }; render()
        })
        val items = hub.items().filter { it.getString("kind") == "resource" }
        if (form == null) {
            items.map { it.optString("form_level") }.distinct().sorted().forEach { f ->
                val key = "form:$f"
                if (showHidden || !hub.hidden(key)) { content.addView(button(f.ifBlank { "All levels" }) { form = f; render() }); content.addView(hideControl(key)) }
            }
        } else if (subject == null) {
            items.filter { it.optString("form_level") == form }.map { it.optString("subject") }.distinct().sorted().forEach { s ->
                val key = "subject:$form:$s"
                if (showHidden || !hub.hidden(key)) { content.addView(button(s.ifBlank { "General" }) { subject = s; render() }); content.addView(hideControl(key)) }
            }
        } else if (category == null) {
            items.filter { it.optString("form_level") == form && it.optString("subject") == subject }
                .map { it.optString("category") }.distinct().sorted().forEach { c -> content.addView(button(c) { category = c; render() }) }
        } else items.filter { it.optString("form_level") == form && it.optString("subject") == subject && it.optString("category") == category }.forEach { item ->
            val key = "item:${item.getString("id")}"
            if (showHidden || !hub.hidden(key)) {
                val file = hub.resourceFile(item)
                content.addView(text(item.getString("title"), 20f))
                content.addView(text(if (file.exists()) "Available offline" else "Waiting to download"))
                content.addView(button("Open resource") {
                    if (!file.exists()) { HubSync.schedule(this); toast("Download queued. Keep your Primebook online.") }
                    else runCatching {
                        val uri = FileProvider.getUriForFile(this, "$packageName.resources", file)
                        startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, item.optString("mime_type"))
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                    }.onFailure { toast("Install an approved app that can open this file type.") }
                })
                content.addView(hideControl(key))
            }
        }
        if (items.isEmpty()) content.addView(text("Your school has not published resources yet."))
    }
    private fun apps() {
        content.addView(text("Approved Apps", 22f))
        content.addView(text("Every app listed here is approved for installation. Apps not listed are not available through your school. Request an app below."))
        hub.items().filter { it.getString("kind") == "app" }.forEach { item ->
            content.addView(text(item.getString("title"), 20f))
            content.addView(text(item.optString("description")))
            val installs = hub.catalog.optJSONArray("installs")
            val recent = installs?.let { a -> (0 until a.length()).map { a.getJSONObject(it) }.firstOrNull { it.optString("item_id") == item.getString("id") } }
            recent?.let { r -> content.addView(text("Install: ${r.optString("status")}${r.optJSONObject("result")?.optString("error")?.let { " • $it" }.orEmpty()}")) }
            val installed = runCatching { packageManager.getPackageInfo(item.getString("package_name"), 0) }.isSuccess
            content.addView(button(if (installed) "Installed" else if (item.optBoolean("preinstall")) "Required • install" else "Install") {
                perform("install", item.getString("id"), "Installation queued. Your device will report the result to school.")
            }.apply { isEnabled = !installed && AgentStore(this@HubActivity).lastStatus == "active" })
        }
        val name = EditText(this).apply { hint = "App you would like" }
        val reason = EditText(this).apply { hint = "Why do you need it?" }
        content.addView(name); content.addView(reason)
        content.addView(button("Request an app") {
            if (name.text.isBlank()) toast("Enter an app name")
            else scope.launch { runCatching {
                SupabaseApi(AgentStore(this@HubActivity)).rpc("device_hub_action", JSONObject().put("p_action", "request_app").put("p_name", name.text.toString()).put("p_reason", reason.text.toString()))
            }.onSuccess { name.text.clear(); reason.text.clear(); toast("Request sent to your school.") }.onFailure { toast(it.message ?: "Request failed") } }
        })
        hub.catalog.optJSONArray("requests")?.let { requests ->
            content.addView(text("Your requests", 20f))
            for (i in 0 until requests.length()) {
                val r = requests.getJSONObject(i)
                content.addView(text("${r.optString("name")} • ${r.optString("status")}"))
            }
        }
    }
    private fun wallpapers() {
        content.addView(text("Make it yours", 22f))
        content.addView(text("Choose from wallpapers approved by your school. Changes apply at the next online check-in, usually within 15 minutes; sleeping or offline devices take longer."))
        if (!hub.catalog.optBoolean("allow_wallpaper_choice", true)) { content.addView(text("Your school has set a fixed wallpaper.")); return }
        hub.items().filter { it.getString("kind") == "wallpaper" }.forEach { item ->
            content.addView(text(item.getString("title"), 20f))
            content.addView(HubImages.preview(this, item, scope))
            content.addView(button("Use this wallpaper") { perform("wallpaper", item.getString("id"), "Wallpaper choice saved. It will apply on an online check-in.") })
        }
    }
    private fun perform(action: String, id: String, message: String) {
        scope.launch { runCatching { SupabaseApi(AgentStore(this@HubActivity)).rpc("device_hub_action", JSONObject().put("p_action", action).put("p_item_id", id)) }
            .onSuccess { CheckInWorker.runNow(this@HubActivity); toast(message) }.onFailure { toast(it.message ?: "Request failed") } }
    }
    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()
}
