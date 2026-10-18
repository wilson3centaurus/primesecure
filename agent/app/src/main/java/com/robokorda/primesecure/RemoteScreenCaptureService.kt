package com.robokorda.primesecure

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject

/** One consented frame, a visible foreground notice, no persistent projection token or video. */
class RemoteScreenCaptureService:Service() {
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main)
    private val handler=Handler(Looper.getMainLooper())
    private var projection:MediaProjection?=null
    private var reader:ImageReader?=null
    private var display:VirtualDisplay?=null
    private var id=""
    private var finished=false
    override fun onBind(intent:Intent?):IBinder?=null
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
        if(intent==null || intent.action==STOP) { stopSelf();return START_NOT_STICKY }
        if(projection!=null) return START_NOT_STICKY
        id=intent.getStringExtra("command").orEmpty()
        try {
            check(AgentStore(this).isEnrolled && RemoteControlRules.validId(id))
            check(intent.getStringExtra("device")==AgentStore(this).deviceId) { "Device enrollment changed" }
            RemoteControls.ensureVisible(this)
            val payload=JSONObject(intent.getStringExtra("payload").orEmpty())
            val stop=PendingIntent.getService(this,ID,Intent(this,RemoteScreenCaptureService::class.java).setAction(STOP),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val notification=Notification.Builder(this,RemoteControls.CHANNEL).setSmallIcon(android.R.drawable.ic_menu_camera)
                .setContentTitle("School screenshot session: one image")
                .setContentText("One screenshot in 5 seconds. Stop cancels. You review it before sending.")
                .setOngoing(true).addAction(Notification.Action.Builder(null,"Stop capture",stop).build()).build()
            if(android.os.Build.VERSION.SDK_INT>=29) startForeground(ID,notification,android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
            else startForeground(ID,notification)
            @Suppress("DEPRECATION")
            val data=intent.getParcelableExtra<Intent>("projection_data") ?: throw IllegalArgumentException("Android screen-sharing consent is missing")
            projection=getSystemService(MediaProjectionManager::class.java).getMediaProjection(intent.getIntExtra("result_code",0),data)
            projection!!.registerCallback(object:MediaProjection.Callback() { override fun onStop() { stopSelf() } },handler)
            val metrics=resources.displayMetrics
            val scale=minOf(1f,1280f/maxOf(metrics.widthPixels,metrics.heightPixels))
            val width=(metrics.widthPixels*scale).toInt().coerceAtLeast(1)
            val height=(metrics.heightPixels*scale).toInt().coerceAtLeast(1)
            val readyAt=SystemClock.elapsedRealtime()+5000
            reader=ImageReader.newInstance(width,height,PixelFormat.RGBA_8888,2)
            reader!!.setOnImageAvailableListener({ source ->
                val image=source.acquireLatestImage() ?: return@setOnImageAvailableListener
                try {
                    if(finished || SystemClock.elapsedRealtime()<readyAt) return@setOnImageAvailableListener
                    finished=true
                    val plane=image.planes[0]
                    val padded=Bitmap.createBitmap(plane.rowStride/plane.pixelStride,height,Bitmap.Config.ARGB_8888)
                    padded.copyPixelsFromBuffer(plane.buffer)
                    val cropped=Bitmap.createBitmap(padded,0,0,width,height)
                    val encoded=try { RemoteCaptureActivity.encode(cropped) } finally { if(cropped!==padded)cropped.recycle();padded.recycle() }
                    val file=RemoteCaptureActivity.previewFile(this,id)
                    file.writeBytes(Base64.decode(encoded.substringAfter(','),Base64.NO_WRAP))
                    Handler(Looper.getMainLooper()).postDelayed({ file.delete() },120_000)
                    val open=RemoteCaptureActivity.intent(this,id,payload,intent.getStringExtra("device")).putExtra("review",true)
                    val review=PendingIntent.getActivity(this,id.hashCode(),open,PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                    RemoteControls.manager(this).notify(RemoteControls.notificationId(id),Notification.Builder(this,RemoteControls.CHANNEL)
                        .setSmallIcon(android.R.drawable.ic_menu_camera).setContentTitle("Review school screenshot")
                        .setContentText("Tap to review and send or discard. Nothing has been uploaded.")
                        .setVisibility(Notification.VISIBILITY_PRIVATE).setTimeoutAfter(120_000).setContentIntent(review).setAutoCancel(true).build())
                    runCatching { startActivity(open) }
                    stopSelf()
                } catch(e:Exception) { DeviceLog.event(this,"error","command","remote_screenshot_failed",e);stopSelf() }
                finally { image.close() }
            },handler)
            // Android's normal mirroring API respects FLAG_SECURE. No accessibility/root bypass.
            // Create the display only after the countdown, so even a completely static screen
            // supplies a fresh first frame; do not depend on a later screen repaint.
            handler.postDelayed({
                runCatching {
                    display=projection?.createVirtualDisplay("Visible single school screenshot",width,height,metrics.densityDpi,DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,reader?.surface,null,handler)
                }.onFailure { DeviceLog.event(this,"error","command","remote_screenshot_failed",it);stopSelf() }
            },5000)
            handler.postDelayed({ stopSelf() },12_000)
        } catch(e:Exception) { DeviceLog.event(this,"error","command","remote_screenshot_failed",e);stopSelf() }
        return START_NOT_STICKY
    }
    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null);display?.release();reader?.close();projection?.stop()
        projection=null;display=null;reader=null;stopForeground(STOP_FOREGROUND_REMOVE)
        scope.cancel();super.onDestroy()
    }
    companion object { private const val ID=961;private const val STOP="stop_visible_screen_capture" }
}
