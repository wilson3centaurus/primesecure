package com.robokorda.primesecure

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.provider.MediaStore
import android.util.Base64
import android.view.Gravity
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import java.io.ByteArrayOutputStream

/** A student opens the camera, reviews the photo and explicitly sends it to support. */
class SupportCaptureActivity : Activity() {
    private var preview: Bitmap? = null
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        if(!AgentStore(this).isEnrolled) { finish(); return }
        val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;gravity=Gravity.CENTER;setPadding(48,48,48,48) }
        root.addView(TextView(this).apply { text="Share a photo with RoboKorda support";textSize=24f;gravity=Gravity.CENTER })
        root.addView(TextView(this).apply { text="Your camera opens only when you choose Take photo. Review the picture before sending. Nothing is recorded in the background.";textSize=17f;setPadding(0,24,0,24) })
        root.addView(Button(this).apply { text="Take photo";setOnClickListener { capture() } })
        root.addView(Button(this).apply { text="Cancel";setOnClickListener { finish() } })
        StudentTheme.styleReader(this,root);setContentView(root)
    }

    @Suppress("DEPRECATION")
    private fun capture() {
        try { startActivityForResult(Intent(MediaStore.ACTION_IMAGE_CAPTURE),CAPTURE) }
        catch(_:android.content.ActivityNotFoundException) {
            AlertDialog.Builder(this).setTitle("Camera unavailable").setMessage("No camera app is available on this Primebook. Send a support message instead.").setPositiveButton("OK",null).show()
        }
    }

    @Deprecated("Activity camera intent result")
    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode:Int,resultCode:Int,data:Intent?) {
        super.onActivityResult(requestCode,resultCode,data)
        if(requestCode!=CAPTURE || resultCode!=RESULT_OK)return
        val photo=data?.extras?.get("data") as? Bitmap ?: run {
            android.widget.Toast.makeText(this,"This camera did not return a photo. Please use a support message.",android.widget.Toast.LENGTH_LONG).show();return
        }
        preview?.recycle();preview=photo
        val view=ImageView(this).apply { setImageBitmap(photo);adjustViewBounds=true;maxHeight=640;setPadding(16,16,16,16) }
        AlertDialog.Builder(this).setTitle("Send this photo to support?").setView(view)
            .setMessage("School support administrators can view this photo. If offline, it waits in Background tasks until connected.")
            .setNegativeButton("Discard",null).setPositiveButton("Send photo") { _,_ -> send(photo) }.show()
    }

    private fun send(photo:Bitmap) {
        val scale=minOf(1f,640f/maxOf(photo.width,photo.height))
        val small=Bitmap.createScaledBitmap(photo,(photo.width*scale).toInt().coerceAtLeast(1),(photo.height*scale).toInt().coerceAtLeast(1),true)
        val bytes=ByteArrayOutputStream().also { small.compress(Bitmap.CompressFormat.JPEG,65,it) }.toByteArray()
        if(small!==photo)small.recycle()
        val image="data:image/jpeg;base64,"+Base64.encodeToString(bytes,Base64.NO_WRAP)
        if(image.length>100_000) {
            android.widget.Toast.makeText(this,"This photo is too large. Please take another picture.",android.widget.Toast.LENGTH_LONG).show();return
        }
        HubTasks(this).enqueue("support_photo",org.json.JSONObject().put("image",image),"Photo for RoboKorda support")
        OfflineWorker.schedule(this)
        android.widget.Toast.makeText(this,"Photo queued for support. See Background tasks for progress.",android.widget.Toast.LENGTH_LONG).show()
        finish()
    }

    override fun onDestroy() { preview?.recycle();preview=null;super.onDestroy() }
    companion object {
        private const val CAPTURE=61
        fun start(context:Context) { context.startActivity(Intent(context,SupportCaptureActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }
}
