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
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            val file = File(intent.getStringExtra("path") ?: error("File unavailable")).canonicalFile
            val notes = File(filesDir,"school-notes").canonicalFile
            @Suppress("DEPRECATION") val shared=android.os.Environment.getExternalStorageDirectory().canonicalFile
            val usb=file.path.matches(Regex("/storage/[0-9a-fA-F]{4}-[0-9a-fA-F]{4}/.+")) && HubStore(this).catalog.optJSONObject("management")?.optBoolean("block_usb_storage") != true
            require(file.isFile && (file.path.startsWith(notes.path+File.separator) || file.path.startsWith(shared.path+File.separator) || usb)) { "File unavailable" }
            val root = LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setPadding(24,20,24,20);setBackgroundColor(android.graphics.Color.rgb(245,247,255)) }
            root.addView(Button(this).apply { text="Back to PrimeSecure";setOnClickListener { finish() } })
            root.addView(TextView(this).apply { text=file.name;textSize=20f;setPadding(0,18,0,18) })
            val mime=intent.getStringExtra("mime") ?: ""
            when {
                mime.startsWith("image/") -> {
                    val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true };BitmapFactory.decodeFile(file.path,bounds)
                    bounds.inJustDecodeBounds=false;bounds.inSampleSize=maxOf(1,maxOf(bounds.outWidth,bounds.outHeight)/1600)
                    imageBitmap=BitmapFactory.decodeFile(file.path,bounds) ?: error("Image format unavailable")
                    root.addView(ImageView(this).apply { setImageBitmap(imageBitmap);scaleType=ImageView.ScaleType.FIT_CENTER },LinearLayout.LayoutParams(-1,0,1f))
                }
                mime.startsWith("video/") -> {
                    video=VideoView(this).apply {
                        setVideoURI(Uri.fromFile(file));setMediaController(MediaController(this@MediaActivity).also { it.setAnchorView(this) })
                        setOnErrorListener { _,_,_ -> Toast.makeText(this@MediaActivity,"This video's format is not supported by the Primebook.",Toast.LENGTH_LONG).show();true }
                        setOnPreparedListener { start() }
                    };root.addView(video,LinearLayout.LayoutParams(-1,0,1f))
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
                    root.addView(ScrollView(this).apply { addView(TextView(this@MediaActivity).apply { this.text=text;textSize=18f;setPadding(10,20,10,20);setTextIsSelectable(true) }) },LinearLayout.LayoutParams(-1,0,1f))
                }
            }
            setContentView(root)
        } catch(e:Exception) { Toast.makeText(this,e.message ?: "Could not open this file.",Toast.LENGTH_LONG).show();finish() }
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
    override fun onDestroy() { audio?.release();audio=null;video?.stopPlayback();imageBitmap?.recycle();super.onDestroy() }
}
private fun java.io.InputStream.readBytesLimited(limit:Int):ByteArray {
    val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192)
    while(true) { val n=read(buffer);if(n<0)break;check(out.size()+n<=limit) { "This document is too large for text view." };out.write(buffer,0,n) }
    return out.toByteArray()
}
