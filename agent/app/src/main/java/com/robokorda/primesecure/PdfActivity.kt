package com.robokorda.primesecure

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.view.Gravity
import android.view.KeyEvent
import android.widget.*
import java.io.File

/** Continuous offline reader. Only visible pages and their neighbours retain bitmaps. */
class PdfActivity : Activity() {
    private var renderer: PdfRenderer? = null
    private var descriptor: ParcelFileDescriptor? = null
    private lateinit var scroll: ScrollView
    private lateinit var pages: LinearLayout
    private val images = mutableListOf<ImageView>()
    private val bitmaps = mutableMapOf<Int, Bitmap>()
    private var zoom = 1f
    private lateinit var position: TextView
    private val paintVisible = Runnable { renderVisible() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            val file = File(intent.getStringExtra("path") ?: error("File unavailable")).canonicalFile
            val notes = File(filesDir, "school-notes").canonicalFile
            @Suppress("DEPRECATION") val shared = android.os.Environment.getExternalStorageDirectory().canonicalFile
            val usb = file.path.matches(Regex("/storage/[0-9a-fA-F]{4}-[0-9a-fA-F]{4}/.+")) &&
                HubStore(this).catalog.optJSONObject("management")?.optBoolean("block_usb_storage") != true
            require(file.isFile && (file.path.startsWith(notes.path + File.separator) || file.path.startsWith(shared.path + File.separator) || usb))
            descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
            renderer = PdfRenderer(descriptor!!)
            require(renderer!!.pageCount in 1..3000) { "This book is too large for this reader." }
            val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(239,243,252)) }
            val bar = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(12,8,12,8) }
            bar.addView(Button(this).apply { text = "Back"; setOnClickListener { finish() } })
            bar.addView(TextView(this).apply { text = file.name; textSize = 18f; gravity = Gravity.CENTER; maxLines = 2; setTextColor(Color.rgb(35,39,74)) }, LinearLayout.LayoutParams(0,-2,1f))
            position = TextView(this).apply { setPadding(16,0,16,0); textSize = 14f }
            bar.addView(position); root.addView(bar)
            pages = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL }
            val horizontal = HorizontalScrollView(this).apply { isFillViewport = true; addView(pages) }
            scroll = ScrollView(this).apply { addView(horizontal); isSmoothScrollingEnabled = true }
            root.addView(scroll, LinearLayout.LayoutParams(-1,0,1f))
            val controls = LinearLayout(this).apply { gravity = Gravity.CENTER }
            for ((label, value) in listOf("Smaller" to -0.25f, "Fit page" to 0f, "Larger" to 0.25f)) {
                controls.addView(Button(this).apply { text = label; setOnClickListener { changeZoom(value) } })
            }
            controls.addView(TextView(this).apply { text = "  Arrows scroll  |  PgUp / PgDn  |  Home / End"; textSize = 12f })
            root.addView(controls); setContentView(root)
            scroll.setOnScrollChangeListener { _,_,_,_,_ -> scroll.removeCallbacks(paintVisible); scroll.postDelayed(paintVisible,40) }
            scroll.post { createPages(); renderVisible() }
        } catch (e: Exception) { Toast.makeText(this,e.message ?: "Could not open PDF.",Toast.LENGTH_LONG).show(); finish() }
    }

    private fun createPages() {
        images.forEach { it.setImageDrawable(null) }; bitmaps.values.forEach { it.recycle() }; bitmaps.clear(); images.clear(); pages.removeAllViews()
        val r = renderer ?: return
        val width = ((scroll.width - 32).coerceAtLeast(200) * zoom).toInt()
        for (index in 0 until r.pageCount) r.openPage(index).use { page ->
            val height = (width.toDouble() * page.height / page.width).toInt().coerceAtLeast(1)
            val image = ImageView(this).apply { setBackgroundColor(Color.WHITE); scaleType = ImageView.ScaleType.FIT_CENTER; contentDescription = "Page ${index+1}" }
            images.add(image); pages.addView(image,LinearLayout.LayoutParams(width,height).apply { setMargins(16,8,16,8) })
        }
        pages.post(paintVisible)
    }

    private fun renderVisible() {
        val r = renderer ?: return
        if (images.isEmpty()) return
        val top = scroll.scrollY; val bottom = top + scroll.height
        val first = images.indexOfFirst { it.bottom >= top }.coerceAtLeast(0)
        val last = images.indexOfLast { it.top <= bottom }.coerceAtLeast(first)
        val keep = (first-1).coerceAtLeast(0)..(last+1).coerceAtMost(images.lastIndex)
        for (index in bitmaps.keys.toList()) if (index !in keep) { images[index].setImageDrawable(null); bitmaps.remove(index)?.recycle() }
        for (index in keep) if (!bitmaps.containsKey(index)) runCatching {
            r.openPage(index).use { page ->
                val width = images[index].layoutParams.width.coerceAtMost(1400)
                val height = (width.toDouble()*page.height/page.width).toInt().coerceIn(1,3000)
                val bitmap = Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888).apply { eraseColor(Color.WHITE) }
                page.render(bitmap,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                bitmaps[index] = bitmap; images[index].setImageBitmap(bitmap)
            }
        }
        position.text = "${first+1} / ${r.pageCount}"
    }

    private fun changeZoom(delta: Float) {
        val fraction = scroll.scrollY.toDouble() / pages.height.coerceAtLeast(1)
        zoom = if (delta == 0f) 1f else (zoom+delta).coerceIn(0.5f,2f)
        createPages(); pages.post { scroll.scrollTo(0,(fraction*pages.height).toInt()); renderVisible() }
    }

    override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
        if (event.action == android.view.KeyEvent.ACTION_DOWN && event.keyCode in setOf(android.view.KeyEvent.KEYCODE_DPAD_DOWN, android.view.KeyEvent.KEYCODE_DPAD_UP, android.view.KeyEvent.KEYCODE_PAGE_DOWN, android.view.KeyEvent.KEYCODE_SPACE, android.view.KeyEvent.KEYCODE_PAGE_UP, android.view.KeyEvent.KEYCODE_MOVE_HOME, android.view.KeyEvent.KEYCODE_MOVE_END, android.view.KeyEvent.KEYCODE_PLUS, android.view.KeyEvent.KEYCODE_EQUALS, android.view.KeyEvent.KEYCODE_MINUS) && onKeyDown(event.keyCode,event)) return true
        return super.dispatchKeyEvent(event)
    }
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (!::scroll.isInitialized) return super.onKeyDown(keyCode,event)
        when (keyCode) {
            KeyEvent.KEYCODE_DPAD_DOWN -> scroll.smoothScrollBy(0,120)
            KeyEvent.KEYCODE_DPAD_UP -> scroll.smoothScrollBy(0,-120)
            KeyEvent.KEYCODE_PAGE_DOWN, KeyEvent.KEYCODE_SPACE -> scroll.smoothScrollBy(0,scroll.height*9/10)
            KeyEvent.KEYCODE_PAGE_UP -> scroll.smoothScrollBy(0,-scroll.height*9/10)
            KeyEvent.KEYCODE_MOVE_HOME -> scroll.smoothScrollTo(0,0)
            KeyEvent.KEYCODE_MOVE_END -> scroll.smoothScrollTo(0,pages.height)
            KeyEvent.KEYCODE_PLUS, KeyEvent.KEYCODE_EQUALS -> changeZoom(0.25f)
            KeyEvent.KEYCODE_MINUS -> changeZoom(-0.25f)
            else -> return super.onKeyDown(keyCode,event)
        }
        return true
    }

    override fun onDestroy() {
        if (::scroll.isInitialized) scroll.removeCallbacks(paintVisible)
        images.forEach { it.setImageDrawable(null) }; bitmaps.values.forEach { it.recycle() }; bitmaps.clear()
        renderer?.close(); renderer = null; descriptor?.close(); super.onDestroy()
    }
}
