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
    private var poll: Job? = null
    private var pickingPhoto=false
    private var refreshing=false
    private var wallpaperBusy=false
    private var cachedRuntime: JSONObject?=null
    private var cachedDevice: JSONObject?=null
    private var cachedAppCount=0
    private var cachedProtectedApps=emptySet<String>()
    private var runtimeAt=0L
    private var uiDirectory: File? = null
    private var uiConfirmed = false
    private val uiTimeout: Runnable = Runnable { if (!uiConfirmed && uiDirectory != null) { StudentUiUpdates.reject(this); uiDirectory=StudentUiUpdates.begin(this); ready=false; web.loadUrl(StudentUiUpdates.ORIGIN+"index.html"); web.postDelayed(uiTimeout,10000) } }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!AgentStore(this).isEnrolled) { startActivity(Intent(this, MainActivity::class.java)); finish(); return }
        if (InitialSetup(this).pending) { startActivity(Intent(this, SetupActivity::class.java)); finish(); return }
        hub = HubStore(this); uiDirectory=StudentUiUpdates.begin(this); web = WebView(this)
        web.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = false; allowFileAccess = false; allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW; setSupportMultipleWindows(false)
        }
        web.addJavascriptInterface(Bridge(), "PrimeNative")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                val uri=request.url
                val name=uri.path?.removePrefix("/") ?: ""
                if(uri.scheme=="https" && uri.host=="student.primesecure.local" && uri.port==-1 && name in setOf("index.html","workspace.js","workspace.css","primebook.png","robokorda.jpg")) {
                    val mime=when(name.substringAfterLast('.')) { "html"->"text/html";"js"->"application/javascript";"css"->"text/css";"png"->"image/png";else->"image/jpeg" }
                    return runCatching { WebResourceResponse(mime,"UTF-8",uiDirectory?.let { File(it,name).inputStream() } ?: assets.open("student/$name")) }.getOrElse { WebResourceResponse("text/plain","UTF-8",java.io.ByteArrayInputStream(ByteArray(0))) }
                }
                return WebResourceResponse("text/plain", "UTF-8", java.io.ByteArrayInputStream(ByteArray(0)))
            }
            override fun onPageFinished(view: WebView, url: String) { ready = true; refresh() }
        }
        setContentView(web); web.loadUrl(StudentUiUpdates.ORIGIN+"index.html"); web.postDelayed(uiTimeout,10000)
        HubSync.schedule(this); pinOnce()
    }
    override fun onResume() {
        super.onResume(); if (!::hub.isInitialized) return
        if (AgentStore(this).lastStatus == "locked") { startActivity(LockActivity.intent(this)); return }
        MessageActivity.showPending(this); if (ready) refresh()
        poll=scope.launch { var tick=0;while(true) {
            delay(1000)
            if(ready) {
                val tasks=withContext(Dispatchers.IO) { JSONObject.quote(HubTasks(this@HubActivity).publicList().toString()) }
                web.evaluateJavascript("window.receiveTasks($tasks,${Connectivity.online(this@HubActivity)})",null)
            }
            if(++tick%5==0&&ready)refresh()
        } }
    }
    override fun onPause() { poll?.cancel();poll=null;super.onPause() }
    override fun onDestroy() { scope.cancel(); if (::web.isInitialized) { web.removeCallbacks(uiTimeout); web.removeJavascriptInterface("PrimeNative"); web.destroy() }; super.onDestroy() }
    @Deprecated("Web workspace navigation")
    override fun onBackPressed() { if (ready) web.evaluateJavascript("window.goBack()", null) else { @Suppress("DEPRECATION") super.onBackPressed() } }
    private fun refresh() {
        if(refreshing)return
        refreshing=true
        scope.launch {
          try {
            val data = withContext(Dispatchers.IO) {
                if(cachedRuntime==null || System.currentTimeMillis()-runtimeAt>60_000L) {
                    cachedRuntime=DeviceRuntime.collect(this@HubActivity);cachedDevice=DeviceInfo.collect(this@HubActivity)
                    cachedProtectedApps=runCatching { AppSafety.protectedPackages(this@HubActivity) }.getOrDefault(setOf(packageName))
                    cachedAppCount=DeviceInfo.installedApps(this@HubActivity).length();runtimeAt=System.currentTimeMillis()
                }
                val catalog = hub.catalog
                val requiredPackages=InitialSetup.requiredApps(catalog,hub.items()).map { it.optString("package_name") }.toSet()
                val items = hub.items().map { item -> JSONObject(item.toString()).apply {
                    put("hidden", hub.hidden("item:${item.getString("id")}"))
                    put("available", item.optString("kind") in setOf("resource","wallpaper") && hub.resourceFile(item).exists())
                    if (item.optString("kind") == "app") {
                        val pkg=item.optString("package_name")
                        val installed=runCatching { packageManager.getPackageInfo(pkg,0) }.getOrNull()
                        val firmware=installed?.applicationInfo?.flags?.let { it and (android.content.pm.ApplicationInfo.FLAG_SYSTEM or android.content.pm.ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0 } ?: false
                        put("installed",installed!=null)
                        put("required",pkg in requiredPackages || pkg in cachedProtectedApps || firmware)
                        put("can_uninstall",installed!=null && pkg !in requiredPackages && pkg !in cachedProtectedApps && !firmware)
                    }
                    val image = File(filesDir,"hub-preview-${item.getString("id")}.jpg")
                    if (image.exists()) put("preview", "data:image/jpeg;base64," + android.util.Base64.encodeToString(image.readBytes(),android.util.Base64.NO_WRAP))
                } }
                catalog.put("items",JSONArray(items)).put("messages",JSONArray(hub.messages()))
                    .put("tasks",HubTasks(this@HubActivity).publicList()).put("online",Connectivity.online(this@HubActivity))
                    .put("runtime",cachedRuntime).put("agent_version",BuildConfig.VERSION_NAME).put("ui_version",uiDirectory?.name?.drop(1)?.toIntOrNull() ?: StudentUiUpdates.BUNDLED_VERSION)
                    .put("capabilities",JSONObject().put("uninstall_optional_apps",true).put("usage_access_setup",true).put("support_photo",true))
                    .put("hidden_keys",JSONArray(hub.hiddenKeys())).put("sync_error",hub.syncError ?: JSONObject.NULL)
                    .put("last_sync",AgentStore(this@HubActivity).lastCheckInAt)
                    .put("school_sync",SettingsSync.snapshot(this@HubActivity))
                    .put("device",cachedDevice).put("battery",DeviceInfo.batteryDiagnostics(this@HubActivity))
                    .put("installed_apps_count",cachedAppCount)
                hub.profileDraft?.let { catalog.put("student_profile",it).put("profile_pending",true) }
                catalog.put("pending_support",JSONArray(HubTasks(this@HubActivity).all().filter { it.optString("action") in setOf("support","name_appeal","support_photo") && it.optString("status") !in setOf("done","superseded") }.map {
                    JSONObject().put("body",if(it.optString("action")=="support_photo")"Photo for support" else it.getJSONObject("payload").optString("body")).put("status",it.optString("status"))
                }))
            }
            if (ready) web.evaluateJavascript("window.receiveState(${JSONObject.quote(data.toString())})",null)
          } finally { refreshing=false }
        }
    }
    private fun pinOnce(force: Boolean = false) {
        val prefs=getSharedPreferences("student-hub",MODE_PRIVATE); val shortcuts=getSystemService(ShortcutManager::class.java)
        if ((force || !prefs.getBoolean("pin_requested",false)) && shortcuts.isRequestPinShortcutSupported && shortcuts.pinnedShortcuts.none { it.id=="student-hub" }) runCatching {
            shortcuts.requestPinShortcut(ShortcutInfo.Builder(this,"student-hub").setShortLabel("PrimeSecure")
                .setIcon(android.graphics.drawable.Icon.createWithResource(this,R.drawable.robokorda))
                .setIntent(Intent(this,HubActivity::class.java).setAction(Intent.ACTION_VIEW)).build(),null)
            prefs.edit().putBoolean("pin_requested",true).apply()
        }
        if (force) toast("Your Primebook launcher controls shortcut placement and whether it can be unpinned.")
    }
    inner class Bridge {
        @JavascriptInterface fun request(raw:String) {
            if(raw.length>120000) return
            scope.launch {
                try {
                    val a=JSONObject(raw)
                    when(a.getString("action")) {
                        "ui_ready" -> if (!uiConfirmed) { uiConfirmed=true; web.removeCallbacks(uiTimeout); StudentUiUpdates.accept(this@HubActivity) }
                        "refresh" -> refresh()
                        "retry_task" -> { withContext(Dispatchers.IO) { HubTasks(this@HubActivity).retry(a.getString("id")) }; OfflineWorker.schedule(this@HubActivity);HubSync.schedule(this@HubActivity);refresh() }
                        "photo" -> {
                            pickingPhoto=true
                            try { startActivityForResult(Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE),804) }
                            catch(_:android.content.ActivityNotFoundException) {
                                val snapshot=withContext(Dispatchers.IO) { TelemetryWorker.snapshot(this@HubActivity) }.optJSONArray("entries") ?: JSONArray()
                                val pictures=(0 until snapshot.length()).map { snapshot.getJSONObject(it) }.filter { it.optString("mime").startsWith("image/")&&!it.optBoolean("dir") }.take(100)
                                check(pictures.isNotEmpty()) { "Add a picture to your Primebook's Pictures folder, then try again." }
                                android.app.AlertDialog.Builder(this@HubActivity).setTitle("Choose a profile picture").setItems(pictures.map { it.optString("name") }.toTypedArray()) { _,index ->
                                    val file=FileManager(AgentStore(this@HubActivity),this@HubActivity).checkedFile(pictures[index].getString("path"))
                                    onActivityResult(804,RESULT_OK,Intent().setData(android.net.Uri.fromFile(file)))
                                }.setNegativeButton("Cancel") { _,_ -> pickingPhoto=false }.show()
                            }
                        }
                        "recovery" -> { PasswordRecovery.activate(this@HubActivity); toast("Confirm your device password if Android asks. Recovery readiness is shown in About Device.");refresh() }
                        "usage_access" -> UsageReporter.openAccessSettings(this@HubActivity)
                        "support_photo" -> SupportCaptureActivity.start(this@HubActivity)
                        "device_password" -> {
                            PasswordRecovery.activate(this@HubActivity)
                            if(PasswordRecovery.status(this@HubActivity)=="ready") {
                                PasswordRecovery.reset(this@HubActivity,a);toast("Device password changed. Your school can reset it if you forget it.")
                            } else toast("Complete password recovery activation first.")
                        }
                        "sync" -> { HubSync.schedule(this@HubActivity); CheckInWorker.runNow(this@HubActivity); TelemetryWorker.schedule(this@HubActivity); toast("Sync requested. Your offline library is still available."); delay(3000); refresh() }
                        "pin" -> pinOnce(true)
                        "hide" -> { withContext(Dispatchers.IO) { hub.hide(a.getString("key"),a.getBoolean("value")) }; refresh() }
                        "message" -> {
                            val m=hub.message(a.getString("id")) ?: error("Message unavailable"); val p=m.getJSONObject("payload")
                            startActivity(MessageActivity.intent(this@HubActivity,m.getString("id"),p.optString("title"),p.optString("body"),p.optString("from")))
                        }
                        "reply" -> {
                            enqueue("reply",JSONObject().put("command_id",a.getString("id")).put("body",a.getString("body")).put("anonymous",a.optBoolean("anonymous")),"Reply to school")
                        }
                        "profile" -> { val profile=a.getJSONObject("profile");withContext(Dispatchers.IO) { hub.profileDraft=profile };enqueue("profile",profile,"Profile details");refresh() }
                        "support","name_appeal" -> enqueue(a.getString("action"),JSONObject().put("body",a.getString("body")),if(a.getString("action")=="support") "Message to RoboKorda" else "Name correction request")
                        "install" -> {
                            val item=hub.items().find { it.optString("id")==a.getString("id") && it.optString("kind")=="app" } ?: error("This app is unavailable.")
                            enqueue("install",JSONObject().put("item_id",item.getString("id")),item.getString("title"),"install:${item.getString("id")}")
                        }
                        "uninstall" -> {
                            val item=hub.items().find { it.optString("id")==a.getString("id") && it.optString("kind")=="app" } ?: error("This app is unavailable.")
                            val pkg=item.optString("package_name")
                            check(pkg!=packageName && InitialSetup.requiredApps(hub.catalog,hub.items()).none { it.optString("package_name")==pkg }) { "Your school requires this app. It cannot be removed." }
                            // The worker checks a fresh authenticated catalogue before making any change.
                            enqueue("uninstall",JSONObject().put("item_id",item.getString("id")),"Remove ${item.getString("title")}","uninstall:${item.getString("id")}")
                        }
                        "wallpaper" -> {
                            check(hub.catalog.optBoolean("allow_wallpaper_choice")) { "Your school has set a fixed wallpaper." }
                            val item=hub.items().find { it.optString("id")==a.getString("id") && it.optString("kind")=="wallpaper" } ?: error("Wallpaper unavailable")
                            check(!wallpaperBusy) { "A wallpaper is being applied. Please wait a moment." }
                            if(hub.resourceFile(item).exists()) {
                                wallpaperBusy=true
                                try {
                                PolicyApplier(this@HubActivity,AgentStore(this@HubActivity)).setWallpaper("hub:"+item.getString("storage_path"))
                                AgentStore(this@HubActivity).appliedWallpaperUrl="hub:"+item.getString("storage_path")
                                withContext(Dispatchers.IO) { hub.localWallpaper=item.getString("id") };enqueue("wallpaper",JSONObject().put("item_id",item.getString("id")),"Wallpaper preference")
                                toast("Wallpaper applied from your offline library.")
                                } finally { wallpaperBusy=false }
                            } else { HubSync.schedule(this@HubActivity);toast("This wallpaper has not downloaded yet. Check Background tasks, then choose it when ready.") }
                        }
                        "request_app" -> enqueue("request_app",JSONObject().put("name",a.getString("name")).put("reason",a.optString("reason")),"App request")
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
                    toast(Connectivity.message(e))
                    if(ready) web.evaluateJavascript("window.actionFailed(${JSONObject.quote(Connectivity.message(e))})",null)
                }
            }
        }
    }
    private fun openFile(file:File,mime:String) {
        val extension=file.extension.lowercase()
        val kind=when { mime=="application/pdf" || extension in setOf("pdf","epub") -> "books";mime.startsWith("image/")->"images";mime.startsWith("video/")->"videos";mime.startsWith("audio/")->"music";else->"documents" }
        val management=hub.catalog.optJSONObject("management")
        val preferred=management?.optJSONObject("viewer_packages")?.optString(kind)?.takeIf { it.isNotBlank() }
        // A viewer is a preference, never an exception to the school's app approval.
        val approved=hub.items().any { it.optString("kind")=="app" && it.optString("package_name")==preferred }
        if(preferred!=null && approved) runCatching {
            val uri=FileProvider.getUriForFile(this,"$packageName.resources",file)
            startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri,mime).setPackage(preferred).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        }.onSuccess { return }.onFailure { toast("Your selected viewer is unavailable for this file. Opening the built-in viewer instead.") }
        if(mime=="application/pdf" || extension=="pdf") { startActivity(Intent(this,PdfActivity::class.java).putExtra("path",file.path));return }
        if(mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/") || extension in setOf("docx","txt","epub","odt")) {
            startActivity(Intent(this,MediaActivity::class.java).putExtra("path",file.path).putExtra("mime",mime));return
        }
        toast("No approved viewer can open this format. Ask your school to select one in Apps → Media viewers.")
    }
    private fun toast(message:String)=Toast.makeText(this,message,Toast.LENGTH_LONG).show()
    private suspend fun enqueue(action:String,payload:JSONObject,title:String,key:String?=null) {
        withContext(Dispatchers.IO) { HubTasks(this@HubActivity).enqueue(action,payload,title,key) };OfflineWorker.schedule(this)
        toast("Saved on this Primebook. ${if(Connectivity.online(this)) "Processing in the background." else "Waiting for internet."} Check Background tasks.")
        refresh()
    }
    @Deprecated("Activity result compatibility")
    override fun onActivityResult(requestCode:Int,resultCode:Int,data:Intent?) {
        super.onActivityResult(requestCode,resultCode,data)
        if(requestCode==803) { CheckInWorker.runNow(this);refresh() }
        if(requestCode==804 && pickingPhoto) {
            pickingPhoto=false
            val uri=data?.data ?: return
            scope.launch {
                try {
                    val photo=withContext(Dispatchers.IO) {
                        val bounds=android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds=true }
                        contentResolver.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it,null,bounds) }
                        check(bounds.outWidth>0&&bounds.outHeight>0) { "Choose a valid image." }
                        bounds.inJustDecodeBounds=false;bounds.inSampleSize=maxOf(1,maxOf(bounds.outWidth,bounds.outHeight)/256)
                        val bitmap=contentResolver.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it,null,bounds) } ?: error("Could not read the image.")
                        val out=java.io.ByteArrayOutputStream();bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG,70,out);bitmap.recycle()
                        check(out.size()<=65000) { "Choose a smaller profile picture." }
                        "data:image/jpeg;base64,"+android.util.Base64.encodeToString(out.toByteArray(),android.util.Base64.NO_WRAP)
                    }
                    if(ready)web.evaluateJavascript("window.receivePhoto(${JSONObject.quote(photo)})",null)
                } catch(e:Exception) { toast(Connectivity.message(e)) }
            }
        }
    }
}
