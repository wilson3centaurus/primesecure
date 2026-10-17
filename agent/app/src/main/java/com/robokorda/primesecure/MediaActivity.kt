package com.robokorda.primesecure

import android.app.Activity
import android.graphics.BitmapFactory
import android.media.MediaPlayer
import android.net.Uri
import android.os.Bundle
import android.widget.*
import java.io.File
import java.util.zip.ZipFile

/** Small native offline viewers. Documents are extracted as text, with no scripts, macros or remote resources. */
class MediaActivity : Activity() {
    private var audio: MediaPlayer? = null
    private var video: VideoView? = null
    private var imageBitmap: android.graphics.Bitmap? = null
    private var currentFile: File? = null
    private var kind = ""
    private var image: ImageView? = null
    private var zoom = 1f
    private var documentScroll: ScrollView? = null
    private var neighbours = emptyList<File>()
    private var mediaIndex = 0
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            val file = File(intent.getStringExtra("path") ?: error("File unavailable")).canonicalFile
            val notes = File(filesDir,"school-notes").canonicalFile
            @Suppress("DEPRECATION") val shared=android.os.Environment.getExternalStorageDirectory().canonicalFile
            val usb=file.path.matches(Regex("/storage/[0-9a-fA-F]{4}-[0-9a-fA-F]{4}/.+")) && HubStore(this).catalog.optJSONObject("management")?.optBoolean("block_usb_storage") != true
            val school=HubStore(this);val allowedSchool=school.items().filter { it.optString("kind") in setOf("resource","wallpaper") || it.optString("kind")=="media"&&school.catalog.optJSONObject("prime_media")?.optBoolean("enabled")==true }.map { school.resourceFile(it).canonicalPath }.toSet()
            require(!file.path.startsWith(notes.path+File.separator)||file.path in allowedSchool) { "This school file is no longer available." }
            require(file.isFile && (file.path.startsWith(notes.path+File.separator) || file.path.startsWith(shared.path+File.separator) || usb)) { "File unavailable" }
            val root = LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setPadding(16,8,16,8);setBackgroundColor(android.graphics.Color.rgb(245,247,255)) }
            val bar=LinearLayout(this).apply { gravity=android.view.Gravity.CENTER_VERTICAL }
            bar.addView(Button(this).apply { text="Back";setOnClickListener { finish() } })
            bar.addView(TextView(this).apply { text=file.name;textSize=14f;maxLines=2;ellipsize=android.text.TextUtils.TruncateAt.MIDDLE;gravity=android.view.Gravity.CENTER;setTextColor(android.graphics.Color.rgb(41,39,75));setPadding(12,8,12,8) },LinearLayout.LayoutParams(0,-2,1f))
            root.addView(bar)
            val mime=intent.getStringExtra("mime") ?: ""
            currentFile=file;kind=mime.substringBefore('/')
            val extensions=when(kind) { "image"->setOf("jpg","jpeg","png","webp","gif","bmp");"video"->setOf("mp4","mkv","webm","3gp","avi","mov");else->emptySet() }
            neighbours=file.parentFile?.listFiles()?.filter { it.isFile && !it.name.startsWith('.') && it.extension.lowercase() in extensions && it.canonicalFile.parentFile==file.parentFile && (!it.path.startsWith(notes.path+File.separator)||it.canonicalPath in allowedSchool) }?.sortedBy { it.name.lowercase() } ?: emptyList()
            mediaIndex=neighbours.indexOf(file).coerceAtLeast(0)
            when {
                mime.startsWith("image/") -> {
                    val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true };BitmapFactory.decodeFile(file.path,bounds)
                    bounds.inJustDecodeBounds=false;bounds.inSampleSize=1;while(maxOf(bounds.outWidth,bounds.outHeight)/bounds.inSampleSize>2000)bounds.inSampleSize*=2
                    imageBitmap=BitmapFactory.decodeFile(file.path,bounds) ?: error("Image format unavailable")
                    image=ImageView(this).apply { setImageBitmap(imageBitmap);scaleType=ImageView.ScaleType.FIT_CENTER;adjustViewBounds=true;contentDescription=file.name }
                    val horizontal=HorizontalScrollView(this).apply { isFillViewport=true;addView(image) }
                    root.addView(ScrollView(this).apply { isFillViewport=true;addView(horizontal) },LinearLayout.LayoutParams(-1,0,1f))
                    image!!.post { imageZoom(0f) }
                    val controls=LinearLayout(this).apply { gravity=android.view.Gravity.CENTER }
                    controls.addView(Button(this).apply { text="−";contentDescription="Zoom out";setOnClickListener { imageZoom(-0.25f) } })
                    controls.addView(Button(this).apply { text="Fit";setOnClickListener { imageZoom(0f) } })
                    controls.addView(Button(this).apply { text="+";contentDescription="Zoom in";setOnClickListener { imageZoom(0.25f) } })
                    root.addView(controls)
                }
                mime.startsWith("video/") -> {
                    video=VideoView(this).apply {
                        setVideoURI(Uri.fromFile(file));setMediaController(MediaController(this@MediaActivity).also { it.setAnchorView(this) })
                        setOnErrorListener { _,_,_ -> Toast.makeText(this@MediaActivity,"This video's format is not supported by the Primebook.",Toast.LENGTH_LONG).show();true }
                        setOnPreparedListener { start() }
                    };root.addView(video,LinearLayout.LayoutParams(-1,0,1f))
                    val controls=LinearLayout(this).apply { gravity=android.view.Gravity.CENTER }
                    controls.addView(Button(this).apply { text="−10 seconds";setOnClickListener { video?.seekTo(((video?.currentPosition ?: 0)-10000).coerceAtLeast(0)) } })
                    controls.addView(Button(this).apply { text="Play / pause";setOnClickListener { if(video?.isPlaying==true)video?.pause() else video?.start() } })
                    controls.addView(Button(this).apply { text="+10 seconds";setOnClickListener { video?.seekTo(((video?.currentPosition ?: 0)+10000).coerceAtMost(video?.duration ?: 0)) } })
                    controls.addView(Button(this).apply { text="Zoom / fit";setOnClickListener { video?.let { val scale=if(it.scaleX>1f)1f else 1.5f;it.scaleX=scale;it.scaleY=scale } } })
                    root.addView(controls)
                }
                mime.startsWith("audio/") -> {
                    val player=MediaPlayer();audio=player;player.setDataSource(file.path)
                    val status=TextView(this).apply { text="Loading audio…";textSize=18f };root.addView(status)
                    val controls=LinearLayout(this)
                    controls.addView(Button(this).apply { text="Play / pause";setOnClickListener { runCatching { if(player.isPlaying)player.pause() else player.start() } } })
                    controls.addView(Button(this).apply { text="Restart";setOnClickListener { runCatching { player.seekTo(0);player.start() } } });root.addView(controls)
                    val seek=SeekBar(this);root.addView(seek)
                    seek.setOnSeekBarChangeListener(object:SeekBar.OnSeekBarChangeListener {
                        override fun onProgressChanged(bar:SeekBar,progress:Int,fromUser:Boolean) { if(fromUser)runCatching { player.seekTo(progress) } }
                        override fun onStartTrackingTouch(bar:SeekBar)=Unit
                        override fun onStopTrackingTouch(bar:SeekBar)=Unit
                    })
                    player.setOnPreparedListener { seek.max=it.duration;status.text="Ready to play";it.start() }
                    player.setOnErrorListener { _,_,_ -> status.text="This audio format is not supported by the Primebook.";true }
                    player.prepareAsync()
                    seek.post(object:Runnable { override fun run() { if(audio!=null) { runCatching { seek.progress=player.currentPosition };seek.postDelayed(this,500) } } })
                }
                else -> {
                    val text=if(file.extension.equals("txt",true)) file.inputStream().use { String(it.readBytesLimited(2_000_000)) }
                    else documentText(file)
                    root.addView(TextView(this).apply { this.text="Text view · formatting and embedded images may differ";textSize=12f })
                    root.addView(ScrollView(this).apply { documentScroll=this;addView(TextView(this@MediaActivity).apply { this.text=text;textSize=18f;setPadding(10,20,10,20);setTextIsSelectable(true) }) },LinearLayout.LayoutParams(-1,0,1f))
                }
            }
            if(kind in setOf("image","video")) {
                val nav=LinearLayout(this).apply { gravity=android.view.Gravity.CENTER }
                nav.addView(Button(this).apply { text="‹ Previous";isEnabled=mediaIndex>0;setOnClickListener { cycle(-1) } })
                nav.addView(TextView(this).apply { text="${mediaIndex+1} / ${neighbours.size.coerceAtLeast(1)}";textSize=14f;setPadding(24,0,24,0) })
                nav.addView(Button(this).apply { text="Next ›";isEnabled=mediaIndex+1<neighbours.size;setOnClickListener { cycle(1) } })
                root.addView(nav)
                root.addView(TextView(this).apply { text=if(kind=="image") "← / → change image   |   + / − zoom   |   0 fit" else "Space: play / pause   |   ← / → seek   |   PgUp / PgDn change video";gravity=android.view.Gravity.CENTER;setPadding(0,8,0,8);textSize=12f })
            }
            StudentTheme.styleReader(this,root);setContentView(root)
        } catch(e:Exception) { Toast.makeText(this,e.message ?: "Could not open this file.",Toast.LENGTH_LONG).show();finish() }
    }
    private fun cycle(step: Int) {
        val file=neighbours.getOrNull(mediaIndex+step) ?: return
        val extension=file.extension.lowercase()
        val mime=android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: "$kind/*"
        intent.putExtra("path",file.path).putExtra("mime",mime);recreate()
    }
    private fun imageZoom(delta: Float) {
        zoom=if(delta==0f)1f else (zoom+delta).coerceIn(0.5f,4f)
        val bitmap=imageBitmap ?: return
        val width=((resources.displayMetrics.widthPixels-48)*zoom).toInt()
        image?.layoutParams=android.widget.FrameLayout.LayoutParams(width,(width.toDouble()*bitmap.height/bitmap.width).toInt())
    }
    override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
        if (event.action == android.view.KeyEvent.ACTION_DOWN && event.keyCode in setOf(android.view.KeyEvent.KEYCODE_DPAD_LEFT, android.view.KeyEvent.KEYCODE_DPAD_RIGHT, android.view.KeyEvent.KEYCODE_PLUS, android.view.KeyEvent.KEYCODE_EQUALS, android.view.KeyEvent.KEYCODE_MINUS, android.view.KeyEvent.KEYCODE_0, android.view.KeyEvent.KEYCODE_SPACE, android.view.KeyEvent.KEYCODE_PAGE_UP, android.view.KeyEvent.KEYCODE_PAGE_DOWN, android.view.KeyEvent.KEYCODE_MOVE_HOME, android.view.KeyEvent.KEYCODE_MOVE_END) && onKeyDown(event.keyCode,event)) return true
        return super.dispatchKeyEvent(event)
    }
    override fun onKeyDown(keyCode: Int,event: android.view.KeyEvent): Boolean {
        if(kind=="image") when(keyCode) {
            android.view.KeyEvent.KEYCODE_DPAD_LEFT->cycle(-1)
            android.view.KeyEvent.KEYCODE_DPAD_RIGHT->cycle(1)
            android.view.KeyEvent.KEYCODE_PLUS,android.view.KeyEvent.KEYCODE_EQUALS->imageZoom(0.25f)
            android.view.KeyEvent.KEYCODE_MINUS->imageZoom(-0.25f)
            android.view.KeyEvent.KEYCODE_0->imageZoom(0f)
            else->return super.onKeyDown(keyCode,event)
        } else if(kind=="video") when(keyCode) {
            android.view.KeyEvent.KEYCODE_SPACE->if(video?.isPlaying==true)video?.pause() else video?.start()
            android.view.KeyEvent.KEYCODE_DPAD_LEFT->video?.seekTo(((video?.currentPosition ?: 0)-10000).coerceAtLeast(0))
            android.view.KeyEvent.KEYCODE_DPAD_RIGHT->video?.seekTo(((video?.currentPosition ?: 0)+10000).coerceAtMost(video?.duration ?: 0))
            android.view.KeyEvent.KEYCODE_PAGE_UP->cycle(-1)
            android.view.KeyEvent.KEYCODE_PAGE_DOWN->cycle(1)
            else->return super.onKeyDown(keyCode,event)
        } else if(documentScroll!=null) when(keyCode) {
            android.view.KeyEvent.KEYCODE_PAGE_DOWN,android.view.KeyEvent.KEYCODE_SPACE->documentScroll?.smoothScrollBy(0,documentScroll!!.height*9/10)
            android.view.KeyEvent.KEYCODE_PAGE_UP->documentScroll?.smoothScrollBy(0,-documentScroll!!.height*9/10)
            android.view.KeyEvent.KEYCODE_MOVE_HOME->documentScroll?.fullScroll(android.view.View.FOCUS_UP)
            android.view.KeyEvent.KEYCODE_MOVE_END->documentScroll?.fullScroll(android.view.View.FOCUS_DOWN)
            else->return super.onKeyDown(keyCode,event)
        } else return super.onKeyDown(keyCode,event)
        return true
    }
    private fun documentText(file:File):String = ZipFile(file).use { zip ->
        val parts=when(file.extension.lowercase()) {
            "docx" -> listOfNotNull(zip.getEntry("word/document.xml"))
            "odt" -> listOfNotNull(zip.getEntry("content.xml"))
            "epub" -> zip.entries().asSequence().filter { it.name.endsWith("xhtml",true)||it.name.endsWith("html",true) }.take(100).toList()
            else -> error("This document format needs an approved reader.")
        }
        check(parts.isNotEmpty()) { "Could not read the document." }
        val output=StringBuilder()
        for(part in parts) {
            val xml=zip.getInputStream(part).use { String(it.readBytesLimited(2_000_000)) }
            val parser=android.util.Xml.newPullParser();parser.setInput(java.io.StringReader(xml))
            while(parser.eventType!=org.xmlpull.v1.XmlPullParser.END_DOCUMENT) {
                if(parser.eventType==org.xmlpull.v1.XmlPullParser.TEXT) output.append(parser.text)
                if(parser.eventType==org.xmlpull.v1.XmlPullParser.END_TAG && parser.name.substringAfter(':') in setOf("p","br","tr","h1","h2","h3","div")) output.append('\n')
                check(output.length<5_000_000) { "This document is too large for text view." };parser.next()
            }
            output.append("\n\n")
        }
        output.toString()
    }
    override fun onPause() { runCatching { audio?.pause() };video?.pause();super.onPause() }
    override fun onDestroy() { audio?.release();audio=null;video?.stopPlayback();image?.setImageDrawable(null);imageBitmap?.recycle();super.onDestroy() }
}
private fun java.io.InputStream.readBytesLimited(limit:Int):ByteArray {
    val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192)
    while(true) { val n=read(buffer);if(n<0)break;check(out.size()+n<=limit) { "This document is too large for text view." };out.write(buffer,0,n) }
    return out.toByteArray()
}
