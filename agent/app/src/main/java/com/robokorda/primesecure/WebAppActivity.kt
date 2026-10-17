package com.robokorda.primesecure

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Bitmap
import android.net.http.SslError
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.*
import android.widget.*
import java.io.ByteArrayInputStream
import kotlinx.coroutines.*

/** Separate from the privileged hub WebView: no native bridge, address bar or external intents. */
class WebAppActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var status: TextView
    private lateinit var progress: ProgressBar
    private var lastAllowed: String? = null
    private var appPackage: String? = null
    private var schoolTool:SchoolWebTool?=null
    private var downloadPrompt=false
    private lateinit var popupHost:FrameLayout
    private var popupCapture:WebView?=null
    private var popupTimeout:Runnable?=null
    private var lastInteraction=0L
    private var failed = false
    private val reportedHosts=java.util.Collections.synchronizedSet(mutableSetOf<String>())
    private var appStillApproved=true
    private val scope=MainScope()
    private var approvalJob:Job?=null
    private val handler = Handler(Looper.getMainLooper())
    private val checkPolicy = object : Runnable {
        override fun run() {
            if (!permittedSession()) { finish(); return }
            val url = web.url
            if (url != null && url != "about:blank" && !allowed(url,true)) { finish();return }
            handler.postDelayed(this, 3000)
        }
    }
    private fun rules() = ApprovedWebApps.rules(this)
    private fun currentTool()=schoolTool?.let { SchoolWebTools.configured(this,it.id) }
    private fun allowed(url:String,mainFrame:Boolean=false)=currentTool()?.let { tool ->
        rules().allows(tool.startUrl)&&(if(mainFrame)tool.allowsNavigation(url) else tool.allowsResource(url,rules()))
    } ?: rules().allows(url)
    private fun permittedSession(): Boolean = AgentStore(this).let { store ->
        store.isEnrolled && store.lastStatus == "active" &&
            getSystemService(android.os.UserManager::class.java).isUserUnlocked &&
            !getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked && rules().enabled &&
            appStillApproved && (schoolTool==null||currentTool()?.let { rules().allows(it.startUrl) }==true)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        appPackage = intent.getStringExtra("web_app_package")
        val toolId=intent.getStringExtra("school_web_tool")
        schoolTool=toolId?.let { SchoolWebTools.configured(this,it) }
        if(toolId!=null&&schoolTool==null) { finish();return }
        appStillApproved=appPackage==null || HubStore(this).items().any { it.optString("kind")=="app" && it.optString("package_name")==appPackage }
        val url = intent.dataString
        if (!permittedSession() || url == null || !allowed(url,true)) {
            Toast.makeText(this,"This website is not approved by your school.",Toast.LENGTH_LONG).show(); finish(); return
        }
        StudentTheme.applyWindow(this)
        ApprovedWebApps.restrictWorkers(this,schoolTool)
        val title = schoolTool?.title ?: appPackage?.let { pkg -> HubStore(this).items().find { it.optString("package_name") == pkg }?.optString("title") } ?: "School web app"
        val bar = LinearLayout(this).apply {
            setPadding(12,8,12,8); gravity = android.view.Gravity.CENTER_VERTICAL; setBackgroundColor(StudentTheme.surface(this@WebAppActivity))
            addView(Button(this@WebAppActivity).apply { text="Back"; setOnClickListener { goBackWithinApp() } })
            addView(TextView(this@WebAppActivity).apply { text=title; textSize=16f; setTextColor(StudentTheme.foreground(this@WebAppActivity)); setPadding(12,0,12,0) },LinearLayout.LayoutParams(0,-2,1f))
            addView(Button(this@WebAppActivity).apply { text="Reload"; setOnClickListener { lastAllowed?.takeIf { allowed(it,true) }?.let(::navigate) } })
            addView(Button(this@WebAppActivity).apply { text="Close"; setOnClickListener { finish() } })
        }
        status=TextView(this).apply { text="Approved school websites only"; setPadding(20,8,20,8); setTextColor(StudentTheme.foreground(this@WebAppActivity)) }
        progress=ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal).apply { max=100 }
        web=WebView(this).apply {
            settings.apply {
                javaScriptEnabled=true; domStorageEnabled=true
                allowFileAccess=false; allowContentAccess=false
                mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW
                javaScriptCanOpenWindowsAutomatically=schoolTool!=null; setSupportMultipleWindows(true)
                mediaPlaybackRequiresUserGesture=true; safeBrowsingEnabled=true
                builtInZoomControls=true; displayZoomControls=false
            }
            CookieManager.getInstance().setAcceptThirdPartyCookies(this,false)
            // No Android link/search context menu that could hand text to another app.
            isLongClickable=false;setOnLongClickListener { true }
            setOnTouchListener { _,event -> if(event.action==android.view.MotionEvent.ACTION_UP)lastInteraction=android.os.SystemClock.elapsedRealtime();false }
            setOnKeyListener { _,_,event -> if(event.action==android.view.KeyEvent.ACTION_UP)lastInteraction=android.os.SystemClock.elapsedRealtime();false }
            webViewClient=object:WebViewClient() {
                override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest):Boolean {
                    val url=request.url.toString()
                    if(request.isForMainFrame&&schoolTool!=null&&!allowed(url,true)) {
                        if(request.method=="GET"&&currentTool()?.allowsDownload(url,rules())==true)confirmDownload(url,web.settings.userAgentString,"School download") else blocked(url)
                        return true
                    }
                    if (!allowed(url,request.isForMainFrame)) { if(request.isForMainFrame) blocked(url); return true };return false
                }
                override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest):WebResourceResponse? {
                    if(allowed(request.url.toString(),request.isForMainFrame)) return null
                    // Includes subframes/resources; file/content/data and external app schemes never pass through.
                    reportBlocked(request.url.toString(),if(request.isForMainFrame)"pages" else "resources")
                    return WebResourceResponse("text/plain","UTF-8",403,"Not approved",mapOf("Cache-Control" to "no-store"),ByteArrayInputStream(ByteArray(0)))
                }
                override fun onPageStarted(view:WebView,url:String,icon:Bitmap?) {
                    if(!allowed(url,true)) { blocked(url);finish();return }
                    failed=false;lastAllowed=url;status.text="Loading school web app..."
                }
                override fun onPageFinished(view:WebView,url:String) { if(!failed) status.text="Approved school websites only" }
                override fun onReceivedError(view:WebView,request:WebResourceRequest,error:WebResourceError) {
                    if(request.isForMainFrame) { failed=true;status.text="Could not connect. Check your internet connection, then Reload." }
                }
                override fun onReceivedSslError(view:WebView,ssl:SslErrorHandler,error:SslError) { ssl.cancel();failed=true;status.text="A secure connection could not be verified." }
            }
            webChromeClient=object:WebChromeClient() {
                override fun onProgressChanged(view:WebView,value:Int) { this@WebAppActivity.progress.progress=value;this@WebAppActivity.progress.visibility=if(value<100) android.view.View.VISIBLE else android.view.View.GONE }
                override fun onCreateWindow(view:WebView,dialog:Boolean,userGesture:Boolean,result:android.os.Message):Boolean {
                    return capturePopup(userGesture,result)
                }
                override fun onPermissionRequest(request:PermissionRequest) { request.deny() }
                override fun onShowFileChooser(view:WebView,callback:android.webkit.ValueCallback<Array<android.net.Uri>>,params:FileChooserParams):Boolean { callback.onReceiveValue(null);status.text="File uploads are not enabled in school web apps.";return true }
            }
            setDownloadListener { target,agent,disposition,mime,_ ->
                if(schoolTool==null)status.text="Downloads from this web app are not enabled. Use your school library."
                else confirmDownload(target,agent.orEmpty(),runCatching { URLUtil.guessFileName(target,disposition,mime) }.getOrDefault("School download"))
            }
        }
        popupHost=FrameLayout(this).apply { visibility=android.view.View.GONE }
        val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setBackgroundColor(StudentTheme.background(this@WebAppActivity));addView(bar);addView(status);addView(progress,LinearLayout.LayoutParams(-1,4));addView(popupHost,LinearLayout.LayoutParams(1,1));addView(web,LinearLayout.LayoutParams(-1,0,1f)) }
        StudentTheme.styleReader(this,bar);setContentView(root)
        val identity=getSharedPreferences("approved-web-identity",MODE_PRIVATE)
        val device=AgentStore(this).deviceId
        if(identity.getString("device",null)!=device) {
            CookieManager.getInstance().removeAllCookies {
                if(!isDestroyed) {
                    web.clearCache(true);WebStorage.getInstance().deleteAllData()
                    identity.edit().putString("device",device).apply();navigate(url)
                }
            }
        } else navigate(url)
    }
    private fun navigate(url:String) { closePopup();if(allowed(url,true)) { lastAllowed=url;web.loadUrl(url) } else blocked(url) }
    private fun goBackWithinApp() {
        if(popupCapture!=null) { closePopup();status.text="Download page cancelled." }
        else if(::web.isInitialized&&web.canGoBack())web.goBack() else finish()
    }
    /** Capture a window.open/target=_blank URL; approved pages reuse our visible WebView. */
    @SuppressLint("SetJavaScriptEnabled")
    private fun capturePopup(gesture:Boolean,result:android.os.Message):Boolean {
        if(!DownloadPopupRules.mayCapture(schoolTool!=null,permittedSession(),popupCapture!=null,gesture,android.os.SystemClock.elapsedRealtime(),lastInteraction)) {
            status.text=if(schoolTool==null)"Separate windows are not enabled in this school web app." else "Click the download button again to open an approved page."
            return false
        }
        val transport=result.obj as? WebView.WebViewTransport ?: return false
        val child=WebView(this);val handled=java.util.concurrent.atomic.AtomicBoolean(false)
        fun route(url:String,method:String="GET") {
            if(url=="about:blank"||!handled.compareAndSet(false,true))return
            handler.post {
                if(popupCapture!==child)return@post
                closePopup()
                if(!permittedSession())return@post
                val tool=currentTool() ?: return@post
                when {
                    method!="GET" -> { reportBlocked(url,"popup_method");status.text="This page needs a form submission that is not supported in the download window." }
                    tool.allowsNavigation(url) -> navigate(url)
                    tool.allowsDownload(url,rules()) -> confirmDownload(url,web.settings.userAgentString,"School download")
                    else -> blocked(url,"pages")
                }
            }
        }
        child.settings.apply { javaScriptEnabled=true;domStorageEnabled=true;allowFileAccess=false;allowContentAccess=false;mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW;safeBrowsingEnabled=true;setSupportMultipleWindows(false);javaScriptCanOpenWindowsAutomatically=false }
        CookieManager.getInstance().setAcceptThirdPartyCookies(child,false)
        child.webViewClient=object:WebViewClient() {
            override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest):Boolean { if(request.isForMainFrame)route(request.url.toString(),request.method);return true }
            override fun onPageStarted(view:WebView,url:String,icon:Bitmap?) { route(url) }
            override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest):WebResourceResponse {
                if(request.isForMainFrame)route(request.url.toString(),request.method)
                return WebResourceResponse("text/plain","UTF-8",403,"Capture only",mapOf("Cache-Control" to "no-store"),ByteArrayInputStream(ByteArray(0)))
            }
            override fun onReceivedSslError(view:WebView,ssl:SslErrorHandler,error:SslError) { ssl.cancel() }
        }
        child.webChromeClient=object:WebChromeClient() {
            override fun onPermissionRequest(request:PermissionRequest) { request.deny() }
            override fun onCreateWindow(view:WebView,dialog:Boolean,userGesture:Boolean,message:android.os.Message)=false
            override fun onCloseWindow(window:WebView) { if(popupCapture===window)closePopup() }
        }
        popupCapture=child;popupHost.addView(child,FrameLayout.LayoutParams(1,1))
        popupTimeout=Runnable { if(popupCapture===child) { closePopup();status.text="The website did not provide a download page. Try its download button again." } }.also { handler.postDelayed(it,60_000) }
        status.text="Checking the requested download page..."
        transport.webView=child;result.sendToTarget();return true
    }
    private fun closePopup() {
        popupTimeout?.let(handler::removeCallbacks);popupTimeout=null
        popupCapture?.let { popupCapture=null;popupHost.removeView(it);it.stopLoading();it.destroy() }
    }
    private fun confirmDownload(url:String,agent:String,name:String) {
        val tool=currentTool() ?: return
        if(downloadPrompt)return
        if(!permittedSession()||!tool.allowsDownload(url,rules())) { reportBlocked(url,"downloads");status.text="This download URL is not approved by your school.";return }
        downloadPrompt=true
        android.app.AlertDialog.Builder(this).setTitle("Save to Media?")
            .setMessage(name.take(120)+"\n\nOnly supported ${if(tool.imagesOnly)"images" else "music and video files"} can be saved. Follow progress in Background tasks.")
            .setPositiveButton("Download") { _,_ ->
                runCatching { WebMediaWorker.enqueue(this,currentTool() ?: error("This website is no longer approved."),url,name,agent) }.onSuccess {
                    status.text="Download queued. Open Background tasks for progress, or Media when it finishes."
                }.onFailure { status.text=it.message ?: "This download could not be queued." }
            }.setNegativeButton("Cancel",null).setOnDismissListener { downloadPrompt=false }.show()
    }
    private fun reportBlocked(url:String,event:String) {
        val uri=runCatching { java.net.URI(url) }.getOrNull();val host=uri?.host ?: return
        if(reportedHosts.size<20&&reportedHosts.add("$event:$host")) {
            val clean=runCatching { java.net.URI(uri.scheme,null,host,uri.port,uri.path,null,null).toString().take(500) }.getOrDefault(host)
            DeviceLog.event(this,"info","web_app","web_event_blocked",details=org.json.JSONObject().put("event",event).put("host",host).put("url_without_query",clean))
        }
    }
    private fun blocked(url:String,event:String="pages") {
        web.stopLoading();failed=true
        reportBlocked(url,event)
        val host=runCatching { java.net.URI(url).host }.getOrNull()
        status.text=if(host==null) "This link is not approved by your school." else "Your school has not approved $host for $event. Ask an administrator to review its download-site URLs."
    }
    override fun onResume() {
        super.onResume();if(!::web.isInitialized)return
        handler.post(checkPolicy)
        approvalJob=scope.launch { while(isActive) {
            appStillApproved=withContext(Dispatchers.IO) { appPackage?.let { pkg ->
                HubStore(this@WebAppActivity).items().any { it.optString("kind")=="app"&&it.optString("package_name")==pkg } &&
                    runCatching { !AdminReceiver.dpm(this@WebAppActivity).isApplicationHidden(AdminReceiver.component(this@WebAppActivity),pkg)&&!AdminReceiver.dpm(this@WebAppActivity).isPackageSuspended(AdminReceiver.component(this@WebAppActivity),pkg) }.getOrDefault(false)
            } ?: true }
            if(!appStillApproved) { finish();return@launch };delay(15_000)
        } }
    }
    override fun onPause() { handler.removeCallbacks(checkPolicy);approvalJob?.cancel();approvalJob=null;closePopup();super.onPause() }
    override fun onDestroy() { handler.removeCallbacks(checkPolicy);scope.cancel();closePopup();if(::web.isInitialized) { web.stopLoading();web.destroy() };if(schoolTool!=null)ApprovedWebApps.restrictWorkers(this);super.onDestroy() }
    @Deprecated("Navigate within approved web app")
    override fun onBackPressed() { goBackWithinApp() }
}
