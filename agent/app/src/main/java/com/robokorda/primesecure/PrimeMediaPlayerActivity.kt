package com.robokorda.primesecure

import android.app.Activity
import android.os.Bundle
import android.webkit.*
import android.widget.*
import kotlinx.coroutines.*
import java.io.ByteArrayInputStream

/** An isolated official embed: no school JavaScript bridge, external intents or general navigation. */
class PrimeMediaPlayerActivity:Activity() {
    private val scope=MainScope()
    private var web:WebView?=null
    private lateinit var status:TextView
    private var checkJob:Job?=null
    private var fullView:android.view.View?=null
    private var fullCallback:WebChromeClient.CustomViewCallback?=null
    private var starting=false
    private val id by lazy { intent.getStringExtra("video_id").orEmpty() }
    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState);StudentTheme.applyWindow(this)
        status=TextView(this).apply { text="Checking school approval…";setPadding(16,12,16,12);setTextColor(StudentTheme.foreground(this@PrimeMediaPlayerActivity)) }
        val bar=LinearLayout(this).apply {
            addView(Button(this@PrimeMediaPlayerActivity).apply { text="Close";setOnClickListener { finish() } })
            addView(status,LinearLayout.LayoutParams(0,-2,1f))
        }
        val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setBackgroundColor(StudentTheme.background(this@PrimeMediaPlayerActivity));addView(bar) };setContentView(root)
        scope.launch {
            try {
                check(PrimeMediaClient.approved(this@PrimeMediaPlayerActivity,id)) { "This video is no longer approved. Return to Prime Media." }
                val player=WebView(this@PrimeMediaPlayerActivity);web=player
                player.settings.apply { javaScriptEnabled=true;domStorageEnabled=true;allowFileAccess=false;allowContentAccess=false;mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW;setSupportMultipleWindows(true);javaScriptCanOpenWindowsAutomatically=false;mediaPlaybackRequiresUserGesture=true;safeBrowsingEnabled=true }
                CookieManager.getInstance().setAcceptThirdPartyCookies(player,false)
                player.isLongClickable=false;player.setOnLongClickListener { true }
                player.webViewClient=object:WebViewClient() {
                    override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest):Boolean {
                        if(request.isForMainFrame||!PrimeMediaRules.playerResource(request.url.toString(),id)) { status.text="External browsing is disabled. Choose another video in Prime Media.";return true };return false
                    }
                    override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest):WebResourceResponse? {
                        if(!request.isForMainFrame&&PrimeMediaRules.playerResource(request.url.toString(),id))return null
                        return WebResourceResponse("text/plain","UTF-8",403,"Not allowed",mapOf("Cache-Control" to "no-store"),ByteArrayInputStream(ByteArray(0)))
                    }
                    override fun onReceivedSslError(view:WebView,handler:SslErrorHandler,error:android.net.http.SslError) { handler.cancel() }
                }
                player.webChromeClient=object:WebChromeClient() {
                    override fun onPermissionRequest(request:PermissionRequest) { request.deny() }
                    override fun onCreateWindow(view:WebView,dialog:Boolean,userGesture:Boolean,message:android.os.Message):Boolean { status.text="External browsing is disabled.";return false }
                    override fun onShowFileChooser(view:WebView,callback:ValueCallback<Array<android.net.Uri>>,params:FileChooserParams):Boolean { callback.onReceiveValue(null);return true }
                    override fun onShowCustomView(view:android.view.View,callback:CustomViewCallback) {
                        if(fullView!=null){callback.onCustomViewHidden();return};fullView=view;fullCallback=callback
                        addContentView(view,android.view.ViewGroup.LayoutParams(-1,-1))
                    }
                    override fun onHideCustomView() { hideFullScreen() }
                }
                player.setDownloadListener { _,_,_,_,_ -> status.text="This is online playback. Downloadable school files are in Prime Media → Download & keep." }
                root.addView(player,LinearLayout.LayoutParams(-1,0,1f))
                // YouTube documents the Android app ID as the embed client's HTTPS referrer.
                val origin="https://$packageName"
                val html="""<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><style>html,body,#player{margin:0;width:100%;height:100%;background:#101421;color:white}#notice{padding:16px;font:16px sans-serif}</style></head><body><div id="player"></div><div id="notice" hidden></div><script src="https://www.youtube.com/iframe_api"></script><script>var player;function onYouTubeIframeAPIReady(){player=new YT.Player('player',{host:'https://www.youtube-nocookie.com',videoId:'$id',playerVars:{playsinline:1,origin:'$origin',rel:0},events:{onStateChange:function(){if(player.getVideoData().video_id!=='$id'){player.stopVideo();document.getElementById('player').hidden=true;document.getElementById('notice').hidden=false;document.getElementById('notice').textContent='Choose another video from Prime Media.'}},onError:function(e){document.getElementById('notice').hidden=false;document.getElementById('notice').textContent='This video cannot play on this Primebook (YouTube '+e.data+'). Choose another video or report this through Support.'}}})}</script></body></html>"""
                player.loadDataWithBaseURL("$origin/",html,"text/html","UTF-8",null)
                status.text="YouTube · Online playback. YouTube may show ads."
                starting=true
                startChecks()
            } catch(e:Exception) { if(e is CancellationException)throw e;status.text=Connectivity.message(e) }
        }
    }
    private fun startChecks() {
        checkJob?.cancel();checkJob=scope.launch { while(true) { delay(15_000);try { if(!PrimeMediaClient.approved(this@PrimeMediaPlayerActivity,id)) { finish();return@launch } }catch(e:Exception){if(e is CancellationException)throw e;web?.evaluateJavascript("player&&player.pauseVideo()",null);status.text="Connection lost. Reconnect and reopen this video."} } }
    }
    private fun hideFullScreen(){fullView?.let { (it.parent as? android.view.ViewGroup)?.removeView(it) };fullView=null;fullCallback?.onCustomViewHidden();fullCallback=null}
    override fun onPause(){checkJob?.cancel();web?.evaluateJavascript("player&&player.pauseVideo()",null);web?.onPause();super.onPause()}
    override fun onResume(){super.onResume();web?.onResume();if(starting)startChecks()}
    @Deprecated("Activity back") override fun onBackPressed(){if(fullView!=null)hideFullScreen() else finish()}
    override fun onDestroy(){checkJob?.cancel();scope.cancel();hideFullScreen();web?.stopLoading();web?.destroy();super.onDestroy()}
}
