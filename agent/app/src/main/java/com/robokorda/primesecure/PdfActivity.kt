package com.robokorda.primesecure

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.widget.*
import java.io.File

/** Offline PDF fallback for books when no external reader is installed. */
class PdfActivity : Activity() {
    private var renderer: PdfRenderer? = null
    private var descriptor: ParcelFileDescriptor? = null
    private var bitmap: Bitmap? = null
    private var page = 0
    private lateinit var image: ImageView
    private lateinit var title: TextView
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val path=intent.getStringExtra("path") ?: return finish()
        val file=File(path).canonicalFile
        val notes=File(filesDir,"school-notes").canonicalFile
        @Suppress("DEPRECATION") val shared=android.os.Environment.getExternalStorageDirectory().canonicalFile
        val removable=file.path.matches(Regex("/storage/[0-9a-fA-F]{4}-[0-9a-fA-F]{4}/.+")) && HubStore(this).catalog.optJSONObject("management")?.optBoolean("block_usb_storage")!=true
        if(!file.path.startsWith(notes.path+File.separator) && !file.path.startsWith(shared.path+File.separator) && !removable) return finish()
        try {
            descriptor=ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY); renderer=PdfRenderer(descriptor!!)
            val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(20,20,20,20); setBackgroundColor(android.graphics.Color.rgb(244,247,253)) }
            val bar=LinearLayout(this)
            bar.addView(Button(this).apply { text="Back to PrimeSecure"; setOnClickListener { finish() } })
            title=TextView(this).apply { textSize=17f; setPadding(20,15,10,15) }; bar.addView(title); root.addView(bar)
            image=ImageView(this).apply { adjustViewBounds=true; scaleType=ImageView.ScaleType.FIT_CENTER }
            root.addView(ScrollView(this).apply { addView(image) },LinearLayout.LayoutParams(-1,0,1f))
            val nav=LinearLayout(this)
            nav.addView(Button(this).apply { text="Previous page"; setOnClickListener { if(page>0){page--;render()} } })
            nav.addView(Button(this).apply { text="Next page"; setOnClickListener { if(page+1<renderer!!.pageCount){page++;render()} } })
            root.addView(nav); setContentView(root); render()
        } catch(e:Exception) { Toast.makeText(this,"Could not open PDF: ${e.message}",Toast.LENGTH_LONG).show(); finish() }
    }
    private fun render() {
        val r=renderer ?: return
        r.openPage(page).use { p ->
            val width=resources.displayMetrics.widthPixels.coerceIn(600,1600)
            val height=(p.height.toDouble()/p.width*width).toInt().coerceIn(1,3000)
            val next=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888); next.eraseColor(android.graphics.Color.WHITE)
            p.render(next,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY); image.setImageBitmap(next); bitmap?.recycle(); bitmap=next
        }
        title.text="Page ${page+1} of ${r.pageCount}"
    }
    override fun onDestroy() { if(::image.isInitialized) image.setImageDrawable(null); bitmap?.recycle(); renderer?.close(); descriptor?.close(); super.onDestroy() }
}
