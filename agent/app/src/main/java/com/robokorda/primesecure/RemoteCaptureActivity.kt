package com.robokorda.primesecure

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.provider.MediaStore
import android.util.Base64
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.time.Instant

/** A request is not permission: device user explicitly allows, reviews and sends one image. */
class RemoteCaptureActivity : Activity() {
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main)
    private var preview:Bitmap?=null
    private var busy=false
    private var id=""
    private var payload=JSONObject()
    private var status:TextView?=null
    override fun onCreate(state:Bundle?) {
        super.onCreate(state)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        if(!AgentStore(this).isEnrolled) { finish();return }
        if(intent.getStringExtra("device")!=AgentStore(this).deviceId) { finish();return }
        id=intent.getStringExtra("command").orEmpty()
        payload=runCatching { JSONObject(intent.getStringExtra("payload").orEmpty()) }.getOrDefault(JSONObject())
        if(!RemoteControlRules.validId(id)) { finish();return }
        val file=previewFile(this,id)
        val reviewing=intent.getBooleanExtra("review",false)
        if(reviewing && file.exists() && System.currentTimeMillis()-file.lastModified() in 0..120_000) {
            val photo=BitmapFactory.decodeFile(file.absolutePath)
            file.delete()
            if(photo!=null) { showPreview(photo);return }
        }
        val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;gravity=Gravity.CENTER;setPadding(40,40,40,40) }
        root.addView(TextView(this).apply { text="School ${if(payload.optString("kind")=="photo") "photo" else "screenshot"} request";textSize=26f })
        root.addView(TextView(this).apply { text="Reason: ${payload.optString("reason")}\n\nNothing is captured until you allow it. One image only; no microphone, video or live feed. Review before sending. Only your school's administrators can view it, for up to 7 days. Do not share private information. You can decline.";textSize=17f;setPadding(0,24,0,24) })
        status=TextView(this).also { root.addView(it) }
        root.addView(Button(this).apply { text=if(payload.optString("kind")=="photo") "Allow camera / take photo" else "Allow one screenshot";setOnClickListener { allow() } })
        root.addView(Button(this).apply { text="Decline";setOnClickListener { decline() } })
        StudentTheme.styleReader(this,root);setContentView(root)
    }
    private fun allow() {
        if(busy)return
        val expiry=runCatching { Instant.parse(payload.getString("expires_at")).toEpochMilli() }.getOrDefault(0)
        if(expiry<=System.currentTimeMillis()) { toast("This request expired. Ask your school to send a new one.");return }
        busy=true
        scope.launch {
            try {
                report("consented")
                check(intent.getStringExtra("device")==AgentStore(this@RemoteCaptureActivity).deviceId) { "Device enrollment changed; request cancelled" }
                if(payload.optString("kind")=="photo") {
                    // Front camera is a hint only; the student's camera app remains in control.
                    @Suppress("DEPRECATION")
                    startActivityForResult(Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra("android.intent.extras.CAMERA_FACING",1).putExtra("android.intent.extra.USE_FRONT_CAMERA",true),CAMERA)
                } else {
                    @Suppress("DEPRECATION")
                    startActivityForResult(getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent(),SCREEN)
                }
            } catch(e:Exception) { if(e is kotlinx.coroutines.CancellationException)throw e;status?.text=Connectivity.message(e);busy=false }
        }
    }
    @Deprecated("Explicit camera and projection consent result")
    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode:Int,resultCode:Int,data:Intent?) {
        super.onActivityResult(requestCode,resultCode,data)
        busy=false
        if(requestCode !in setOf(CAMERA,SCREEN))return
        if(resultCode!=RESULT_OK || data==null) { decline();return }
        if(requestCode==CAMERA) {
            val photo=data.extras?.get("data") as? Bitmap
            if(photo==null) { toast("Camera did not return an image; no photo was sent.");decline();return }
            showPreview(photo)
        } else {
            try {
                startForegroundService(Intent(this,RemoteScreenCaptureService::class.java)
                    .putExtra("command",id).putExtra("payload",payload.toString())
                    .putExtra("device",intent.getStringExtra("device"))
                    .putExtra("result_code",resultCode).putExtra("projection_data",data))
                toast("One screenshot in 5 seconds. Use the visible Stop control to cancel; protected windows stay protected.")
                finish()
            } catch(e:Exception) { toast(Connectivity.message(e));decline() }
        }
    }
    private fun showPreview(photo:Bitmap) {
        preview?.recycle();preview=photo
        val view=ImageView(this).apply { setImageBitmap(photo);adjustViewBounds=true;maxHeight=640 }
        AlertDialog.Builder(this).setTitle("Send this image to your school?")
            .setMessage("One image, visible to school administrators for up to 7 days. Do not send private content.")
            .setView(view).setNegativeButton("Discard") { _,_->decline() }
            .setOnCancelListener { decline() }
            .setPositiveButton("Send image",null).create().apply {
                setOnShowListener { getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                    if(busy)return@setOnClickListener
                    busy=true;getButton(AlertDialog.BUTTON_POSITIVE).isEnabled=false
                    scope.launch {
                        try { report("completed",encode(photo));RemoteControls.manager(this@RemoteCaptureActivity).cancel(RemoteControls.notificationId(id));toast("Image sent to your school.");dismiss();finish() }
                        catch(e:Exception) { if(e is kotlinx.coroutines.CancellationException)throw e;toast(Connectivity.message(e));busy=false;getButton(AlertDialog.BUTTON_POSITIVE).isEnabled=true }
                    }
                } };show()
            }
    }
    private fun decline() {
        if(busy)return
        busy=true
        scope.launch {
            try { report("declined");RemoteControls.manager(this@RemoteCaptureActivity).cancel(RemoteControls.notificationId(id));finish() }
            catch(e:Exception) { if(e is kotlinx.coroutines.CancellationException)throw e;toast("Nothing was sent. ${Connectivity.message(e)}");busy=false }
        }
    }
    private suspend fun report(state:String,image:String?=null) = SupabaseApi(AgentStore(this)).rpc("device_remote_capture",JSONObject().put("p_command",id).put("p_state",state).put("p_image",image ?: JSONObject.NULL))
    private fun toast(message:String) { Toast.makeText(this,message,Toast.LENGTH_LONG).show() }
    override fun onDestroy() { preview?.recycle();preview=null;scope.cancel();super.onDestroy() }
    companion object {
        private const val CAMERA=71
        private const val SCREEN=72
        fun intent(context:Context,id:String,payload:JSONObject,device:String?=AgentStore(context).deviceId) = Intent(context,RemoteCaptureActivity::class.java).putExtra("command",id).putExtra("payload",payload.toString()).putExtra("device",device).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        fun previewFile(context:Context,id:String):File {
            require(RemoteControlRules.validId(id))
            val dir=File(context.cacheDir,"visible-capture").apply { mkdirs() }
            // Unsent local previews expire at two minutes; never become library/media resources.
            dir.listFiles()?.filter { System.currentTimeMillis()-it.lastModified()>120_000 }?.forEach { it.delete() }
            return File(dir,"$id.jpg")
        }
        fun encode(photo:Bitmap):String {
            val scale=minOf(1f,1280f/maxOf(photo.width,photo.height))
            val small=Bitmap.createScaledBitmap(photo,(photo.width*scale).toInt().coerceAtLeast(1),(photo.height*scale).toInt().coerceAtLeast(1),true)
            try {
                for(quality in listOf(75,55,35,20)) {
                    val bytes=ByteArrayOutputStream().also { small.compress(Bitmap.CompressFormat.JPEG,quality,it) }.toByteArray()
                    if(bytes.size<=RemoteControlRules.MAX_CAPTURE_BYTES) return "data:image/jpeg;base64,"+Base64.encodeToString(bytes,Base64.NO_WRAP)
                }
                throw IllegalArgumentException("Image is too large; try a simpler image")
            } finally { if(small!==photo)small.recycle() }
        }
    }
}
