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
            if (url != null && url != "about:blank" && !rules().allows(url)) { finish();return }
            handler.postDelayed(this, 3000)
        }
    }
    private fun rules() = ApprovedWebApps.rules(this)
    private fun permittedSession(): Boolean = AgentStore(this).let { store ->
        store.isEnrolled && store.lastStatus == "active" &&
            getSystemService(android.os.UserManager::class.java).isUserUnlocked &&
            !getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked && rules().enabled &&
            appStillApproved
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        appPackage = intent.getStringExtra("web_app_package")
        appStillApproved=appPackage==null || HubStore(this).items().any { it.optString("kind")=="app" && it.optString("package_name")==appPackage }
        val url = intent.dataString
        if (!permittedSession() || url == null || !rules().allows(url)) {
            Toast.makeText(this,"This website is not approved by your school.",Toast.LENGTH_LONG).show(); finish(); return
        }
        StudentTheme.applyWindow(this)
        ApprovedWebApps.restrictWorkers(this)
        val title = appPackage?.let { pkg -> HubStore(this).items().find { it.optString("package_name") == pkg }?.optString("title") } ?: "School web app"
        val bar = LinearLayout(this).apply {
            setPadding(12,8,12,8); gravity = android.view.Gravity.CENTER_VERTICAL; setBackgroundColor(StudentTheme.surface(this@WebAppActivity))
            addView(Button(this@WebAppActivity).apply { text="Back"; setOnClickListener { if(web.canGoBack()) web.goBack() else finish() } })
            addView(TextView(this@WebAppActivity).apply { text=title; textSize=16f; setTextColor(StudentTheme.foreground(this@WebAppActivity)); setPadding(12,0,12,0) },LinearLayout.LayoutParams(0,-2,1f))
            addView(Button(this@WebAppActivity).apply { text="Reload"; setOnClickListener { lastAllowed?.takeIf { rules().allows(it) }?.let(::navigate) } })
            addView(Button(this@WebAppActivity).apply { text="Close"; setOnClickListener { finish() } })
        }
        status=TextView(this).apply { text="Approved school websites only"; setPadding(20,8,20,8); setTextColor(StudentTheme.foreground(this@WebAppActivity)) }
        progress=ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal).apply { max=100 }
        web=WebView(this).apply {
            settings.apply {
                javaScriptEnabled=true; domStorageEnabled=true
                allowFileAccess=false; allowContentAccess=false
                mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW
                javaScriptCanOpenWindowsAutomatically=false; setSupportMultipleWindows(true)
                mediaPlaybackRequiresUserGesture=true; safeBrowsingEnabled=true
                builtInZoomControls=true; displayZoomControls=false
            }
            CookieManager.getInstance().setAcceptThirdPartyCookies(this,false)
            // No Android link/search context menu that could hand text to another app.
            isLongClickable=false;setOnLongClickListener { true }
            webViewClient=object:WebViewClient() {
                override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest):Boolean {
                    if (!rules().allows(request.url.toString())) { if(request.isForMainFrame) blocked(request.url.toString()); return true };return false
                }
                override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest):WebResourceResponse? {
                    if(rules().allows(request.url.toString())) return null
                    // Includes subframes/resources; file/content/data and external app schemes never pass through.
                    val host=request.url.host
                    if(host!=null&&reportedHosts.size<20&&reportedHosts.add(host)) DeviceLog.event(this@WebAppActivity,"info","web_app","web_host_blocked",details=org.json.JSONObject().put("reason",host))
                    return WebResourceResponse("text/plain","UTF-8",403,"Not approved",mapOf("Cache-Control" to "no-store"),ByteArrayInputStream(ByteArray(0)))
                }
                override fun onPageStarted(view:WebView,url:String,icon:Bitmap?) {
                    if(!rules().allows(url)) { blocked(url);finish();return }
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
                    status.text="This app requested a separate window. Use a sign-in flow that stays in this window.";return false
                }
                override fun onPermissionRequest(request:PermissionRequest) { request.deny() }
                override fun onShowFileChooser(view:WebView,callback:android.webkit.ValueCallback<Array<android.net.Uri>>,params:FileChooserParams):Boolean { callback.onReceiveValue(null);status.text="File uploads are not enabled in school web apps.";return true }
            }
            setDownloadListener { _,_,_,_,_-> status.text="Downloads from web apps are not enabled. Use your school library." }
        }
        val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setBackgroundColor(StudentTheme.background(this@WebAppActivity));addView(bar);addView(status);addView(progress,LinearLayout.LayoutParams(-1,4));addView(web,LinearLayout.LayoutParams(-1,0,1f)) }
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
    private fun navigate(url:String) { if(rules().allows(url)) { lastAllowed=url;web.loadUrl(url) } else blocked(url) }
    private fun blocked(url:String) {
        web.stopLoading();failed=true
        val host=runCatching { java.net.URI(url).host }.getOrNull()
        status.text=if(host==null) "This link is not approved by your school." else "Your school has not approved $host."
    }
    override fun onResume() {
        super.onResume();if(!::web.isInitialized)return
        handler.post(checkPolicy)
        approvalJob=scope.launch { while(isActive) {
            appStillApproved=withContext(Dispatchers.IO) { appPackage?.let { pkg ->
                HubStore(this@WebAppActivity).items().any { it.optString("kind")=="app"&&it.optString("package_name")==pkg } &&
                    runCatching { !AdminReceiver.dpm(this@WebAppActivity).isApplicationHidden(AdminReceiver.component(this@WebAppActivity),pkg)&&!packageManager.isPackageSuspended(pkg) }.getOrDefault(false)
            } ?: true }
            if(!appStillApproved) { finish();return@launch };delay(15_000)
        } }
    }
    override fun onPause() { handler.removeCallbacks(checkPolicy);approvalJob?.cancel();approvalJob=null;super.onPause() }
    override fun onDestroy() { handler.removeCallbacks(checkPolicy);scope.cancel();if(::web.isInitialized) { web.stopLoading();web.destroy() };super.onDestroy() }
    @Deprecated("Navigate within approved web app")
    override fun onBackPressed() { if(::web.isInitialized&&web.canGoBack())web.goBack() else finish() }
}
