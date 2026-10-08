package com.robokorda.primesecure

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.text.Html
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import org.json.JSONObject

/** "School Browser": a plain WebView that enforces the policy's web filter on every navigation. */
class BrowserActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var address: EditText

    private val filter: WebFilter
        get() = WebFilter.fromJson(AgentStore(this).webFilter?.let { runCatching { JSONObject(it) }.getOrNull() })

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = "School Browser"

        address = EditText(this).apply {
            setSingleLine()
            hint = "Search or type a web address"
            imeOptions = EditorInfo.IME_ACTION_GO
            setOnEditorActionListener { _, actionId, event ->
                val go = actionId == EditorInfo.IME_ACTION_GO ||
                    (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
                if (go) navigate(text.toString())
                go
            }
        }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(Button(this@BrowserActivity).apply { text = "◀"; setOnClickListener { if (web.canGoBack()) web.goBack() } })
            addView(Button(this@BrowserActivity).apply { text = "⟳"; setOnClickListener { web.reload() } })
            addView(Button(this@BrowserActivity).apply { text = "⌂"; setOnClickListener { navigate(home()) } })
            addView(address, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        }
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (!request.isForMainFrame) return false
                    return intercept(request.url.toString())
                }

                override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                    if (!url.startsWith("data:")) address.setText(url)
                }
            }
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(bar)
            addView(web, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        })
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else navigate(home())
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Back navigates the web view first")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    private fun home() = filter.homeUrl ?: "https://www.google.com/"

    private fun navigate(input: String) {
        val text = input.trim()
        if (text.isEmpty()) return
        val url = when {
            text.startsWith("http://") || text.startsWith("https://") -> text
            text.contains('.') && !text.contains(' ') -> "https://$text"
            else -> "https://www.google.com/search?q=" + android.net.Uri.encode(text)
        }
        if (!intercept(url)) web.loadUrl(url)
    }

    /** True when we handled the navigation (blocked or rewritten) instead of the WebView. */
    private fun intercept(url: String): Boolean {
        val f = filter
        if (!f.allows(url)) {
            val host = android.net.Uri.parse(url).host ?: url
            val html = "<html><body style='font-family:sans-serif;padding:48px;text-align:center'>" +
                "<h2>Blocked by your school</h2><p>${Html.escapeHtml(host)} is not allowed.</p></body></html>"
            web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
            address.setText(url)
            return true
        }
        val rewritten = f.rewrite(url)
        if (rewritten != url) {
            web.loadUrl(rewritten)
            return true
        }
        return false
    }
}
