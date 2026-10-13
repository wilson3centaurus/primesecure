package com.robokorda.primesecure

import android.app.Activity
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.os.Bundle
import android.webkit.*
import android.widget.Toast
import androidx.core.content.FileProvider
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Bundled offline UI. Credentials stay native; remote navigation is blocked. */
class HubActivity : Activity() {
    private val scope = MainScope()
    private lateinit var web: WebView
    private lateinit var hub: HubStore
    private var ready = false
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!AgentStore(this).isEnrolled) { startActivity(Intent(this, MainActivity::class.java)); finish(); return }
        hub = HubStore(this); web = WebView(this)
        web.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = false; allowFileAccess = false; allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW; setSupportMultipleWindows(false)
        }
        web.addJavascriptInterface(Bridge(), "PrimeNative")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                if (request.url.toString().startsWith("file:///android_asset/student/")) null
                else WebResourceResponse("text/plain", "UTF-8", java.io.ByteArrayInputStream(ByteArray(0)))
            override fun onPageFinished(view: WebView, url: String) { ready = true; refresh() }
        }
        setContentView(web); web.loadUrl("file:///android_asset/student/index.html")
        HubSync.schedule(this); pinOnce()
    }
    override fun onResume() {
        super.onResume(); if (!::hub.isInitialized) return
        if (AgentStore(this).lastStatus == "locked") { startActivity(LockActivity.intent(this)); return }
        MessageActivity.showPending(this); if (ready) refresh()
    }
    override fun onDestroy() { scope.cancel(); if (::web.isInitialized) { web.removeJavascriptInterface("PrimeNative"); web.destroy() }; super.onDestroy() }
    @Deprecated("Web workspace navigation")
    override fun onBackPressed() { if (ready) web.evaluateJavascript("window.goBack()", null) else { @Suppress("DEPRECATION") super.onBackPressed() } }
    private fun refresh() {
        scope.launch {
            val data = withContext(Dispatchers.IO) {
                val catalog = hub.catalog
                val items = hub.items().map { item -> JSONObject(item.toString()).apply {
                    put("hidden", hub.hidden("item:${item.getString("id")}"))
                    put("available", item.optString("kind") == "resource" && hub.resourceFile(item).exists())
                    if (item.optString("kind") == "app") put("installed", runCatching { packageManager.getPackageInfo(item.getString("package_name"),0) }.isSuccess)
                    val image = File(filesDir,"hub-preview-${item.getString("id")}.jpg")
                    if (image.exists()) put("preview", "data:image/jpeg;base64," + android.util.Base64.encodeToString(image.readBytes(),android.util.Base64.NO_WRAP))
                } }
                catalog.put("items",JSONArray(items)).put("messages",JSONArray(hub.messages()))
                    .put("hidden_keys",JSONArray(hub.hiddenKeys())).put("sync_error",hub.syncError ?: JSONObject.NULL)
                    .put("last_sync",AgentStore(this@HubActivity).lastCheckInAt)
                    .put("device",DeviceInfo.collect(this@HubActivity)).put("battery",DeviceInfo.batteryDiagnostics(this@HubActivity))
                    .put("installed_apps_count",DeviceInfo.installedApps(this@HubActivity).length())
            }
            if (ready) web.evaluateJavascript("window.receiveState(${JSONObject.quote(data.toString())})",null)
        }
    }
    private fun pinOnce(force: Boolean = false) {
        val prefs=getSharedPreferences("student-hub",MODE_PRIVATE); val shortcuts=getSystemService(ShortcutManager::class.java)
        if ((force || !prefs.getBoolean("pin_requested",false)) && shortcuts.isRequestPinShortcutSupported && shortcuts.pinnedShortcuts.none { it.id=="student-hub" }) runCatching {
            shortcuts.requestPinShortcut(ShortcutInfo.Builder(this,"student-hub").setShortLabel("PrimeSecure")
                .setIcon(android.graphics.drawable.Icon.createWithResource(this,R.drawable.primebook))
                .setIntent(Intent(this,HubActivity::class.java).setAction(Intent.ACTION_VIEW)).build(),null)
            prefs.edit().putBoolean("pin_requested",true).apply()
        }
        if (force) toast("Your Primebook launcher controls shortcut placement and whether it can be unpinned.")
    }
    inner class Bridge {
        @JavascriptInterface fun request(raw:String) {
            if(raw.length>10000) return
            scope.launch {
                try {
                    val a=JSONObject(raw); val api=SupabaseApi(AgentStore(this@HubActivity))
                    when(a.getString("action")) {
                        "refresh" -> refresh()
                        "sync" -> { HubSync.schedule(this@HubActivity); CheckInWorker.runNow(this@HubActivity); TelemetryWorker.schedule(this@HubActivity); toast("Sync requested. Your offline library is still available."); delay(3000); refresh() }
                        "pin" -> pinOnce(true)
                        "hide" -> { hub.hide(a.getString("key"),a.getBoolean("value")); refresh() }
                        "message" -> {
                            val m=hub.message(a.getString("id")) ?: error("Message unavailable"); val p=m.getJSONObject("payload")
                            startActivity(MessageActivity.intent(this@HubActivity,m.getString("id"),p.optString("title"),p.optString("body"),p.optString("from")))
                        }
                        "reply" -> {
                            api.rpc("device_message_reply",JSONObject().put("p_command_id",a.getString("id")).put("p_body",a.getString("body")).put("p_anonymous",a.optBoolean("anonymous")))
                            toast("Reply sent. Administrators can identify the sender."); HubSync.schedule(this@HubActivity)
                        }
                        "profile" -> { api.rpc("device_student_profile",JSONObject().put("p_profile",a.getJSONObject("profile"))); hub.catalog=api.rpc("device_hub"); toast("Emergency details saved securely"); refresh() }
                        "install", "wallpaper" -> { api.rpc("device_hub_action",JSONObject().put("p_action",a.getString("action")).put("p_item_id",a.getString("id"))); CheckInWorker.runNow(this@HubActivity); toast(if(a.getString("action")=="install") "Installation queued" else "Wallpaper saved. It applies on an online check-in.") }
                        "request_app" -> { api.rpc("device_hub_action",JSONObject().put("p_action","request_app").put("p_name",a.getString("name")).put("p_reason",a.optString("reason"))); toast("Request sent"); HubSync.schedule(this@HubActivity) }
                        "resource" -> {
                            val item=hub.items().find { it.getString("id")==a.getString("id") && it.optString("kind")=="resource" } ?: error("Resource unavailable")
                            val file=hub.resourceFile(item)
                            if(!file.exists()) { HubSync.schedule(this@HubActivity); toast("Download queued. Keep your Primebook online.") }
                            else openFile(file,item.optString("mime_type","application/octet-stream"))
                        }
                        "files" -> {
                            val listing=withContext(Dispatchers.IO) { FileManager(AgentStore(this@HubActivity),this@HubActivity).list(JSONObject().put("path",a.optString("path"))) }
                            web.evaluateJavascript("window.receiveFiles(${JSONObject.quote(listing.toString())})",null)
                        }
                        "media" -> {
                            val listing=withContext(Dispatchers.IO) {
                                val cached=File(filesDir,"file-inventory.json")
                                val snapshot=if(cached.exists()) JSONObject(cached.readText()) else TelemetryWorker.snapshot(this@HubActivity)
                                snapshot.put("path","")
                            }
                            web.evaluateJavascript("window.receiveFiles(${JSONObject.quote(listing.toString())})",null)
                        }
                        "open_file" -> { val file=FileManager(AgentStore(this@HubActivity),this@HubActivity).checkedFile(a.getString("path")); openFile(file,MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: "application/octet-stream") }
                    }
                } catch(e:Exception) {
                    if(e is CancellationException) throw e
                    toast(e.message ?: "Action could not be completed")
                    if(ready) web.evaluateJavascript("window.actionFailed(${JSONObject.quote(e.message ?: "Please try again")})",null)
                }
            }
        }
    }
    private fun openFile(file:File,mime:String) {
        val viewers=hub.catalog.optJSONObject("management")?.optJSONObject("viewer_packages")
        val kind=when { mime=="application/pdf" || file.extension.lowercase() in listOf("epub","pdf") -> "books"; mime.startsWith("image/")->"images"; mime.startsWith("video/")->"videos"; mime.startsWith("audio/")->"music"; else->"documents" }
        val preferred=viewers?.optString(kind)?.takeIf { it.isNotBlank() }
        val uri=FileProvider.getUriForFile(this,"$packageName.resources",file)
        val view=Intent(Intent.ACTION_VIEW).setDataAndType(uri,mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if(preferred!=null) view.setPackage(preferred)
        try { startActivity(view) } catch(_:android.content.ActivityNotFoundException) {
            if(preferred!=null) view.setPackage(null)
            try { startActivity(view) } catch(_:android.content.ActivityNotFoundException) {
                if(mime=="application/pdf" || file.extension.equals("pdf",true)) startActivity(Intent(this,PdfActivity::class.java).putExtra("path",file.path))
                else toast("No reader installed for this type. Ask school to approve a viewer in the App Store.")
            }
        }
    }
    private fun toast(message:String)=Toast.makeText(this,message,Toast.LENGTH_LONG).show()
}
