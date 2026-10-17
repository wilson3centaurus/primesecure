package com.robokorda.primesecure

import android.app.Activity
import android.os.Bundle
import android.webkit.*
import android.widget.*

/** Public provider terms only; not a general-purpose browser. No native bridge. */
class PrimeMediaLegalActivity:Activity() {
    private var web:WebView?=null
    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState)
        val privacy=intent.getStringExtra("document")=="privacy"
        val url=if(privacy)"https://policies.google.com/privacy?hl=en" else "https://www.youtube.com/t/terms"
        fun allowed(value:String)=runCatching {
            val u=java.net.URI(value)
            u.scheme=="https"&&u.rawUserInfo==null&&u.port in setOf(-1,443)&&((u.host=="policies.google.com"&&u.path in setOf("/privacy","/terms"))||(u.host=="www.youtube.com"&&u.path=="/t/terms"))
        }.getOrDefault(false)
        val browser=WebView(this);web=browser
        browser.settings.apply { javaScriptEnabled=false;allowFileAccess=false;allowContentAccess=false;setSupportMultipleWindows(false);mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW }
        browser.webViewClient=object:WebViewClient() {
            override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest)=!allowed(request.url.toString())
            override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest):WebResourceResponse? {
                if(allowed(request.url.toString()))return null
                return WebResourceResponse("text/plain","UTF-8",java.io.ByteArrayInputStream(ByteArray(0)))
            }
            override fun onReceivedSslError(view:WebView,handler:SslErrorHandler,error:android.net.http.SslError){handler.cancel()}
        }
        val root=LinearLayout(this).apply {orientation=LinearLayout.VERTICAL;addView(Button(this@PrimeMediaLegalActivity).apply {text="Close ${if(privacy)"Google Privacy" else "YouTube Terms"}";setOnClickListener {finish()} });addView(browser,LinearLayout.LayoutParams(-1,0,1f))}
        setContentView(root);browser.loadUrl(url)
    }
    override fun onDestroy(){web?.destroy();super.onDestroy()}
}
