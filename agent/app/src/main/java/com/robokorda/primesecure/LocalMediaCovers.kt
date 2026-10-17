package com.robokorda.primesecure

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.pdf.PdfRenderer
import android.media.MediaMetadataRetriever
import android.media.ThumbnailUtils
import android.os.ParcelFileDescriptor
import android.util.Size
import java.io.ByteArrayOutputStream
import java.io.File

/** Small previews generated on WebView's request thread. Never exposes file URLs or uploads media. */
internal object LocalMediaCovers {
    private val cache=object:android.util.LruCache<String,ByteArray>(6*1024*1024) {
        override fun sizeOf(key:String,value:ByteArray)=value.size
    }
    @Synchronized fun read(context:Context,path:String,key:String):ByteArray? {
        val store=AgentStore(context)
        if(!store.isEnrolled||store.lastStatus!="active"||!FileManager.hasAccess())return null
        return runCatching {
            val file=FileManager(store,context).checkedFile(path)
            if(token(store.deviceId,path,file)!=key)return null
            render(file,key)
        }.getOrNull()
    }
    /** Caller supplies an already authorized local file, never a WebView path. */
    @Synchronized fun render(file:File,key:String):ByteArray? = runCatching {
            cache.get(key)?.let { return@runCatching it }
            val bitmap=when(file.extension.lowercase()) {
                "jpg","jpeg","png","webp","gif","bmp","heic","heif"->if(android.os.Build.VERSION.SDK_INT>=29)ThumbnailUtils.createImageThumbnail(file,Size(320,240),null) else decodeImage(file)
                "mp4","webm","mkv","avi","mov","m4v","3gp"->if(android.os.Build.VERSION.SDK_INT>=29)ThumbnailUtils.createVideoThumbnail(file,Size(320,240),null) else ThumbnailUtils.createVideoThumbnail(file.path,android.provider.MediaStore.Video.Thumbnails.MINI_KIND)
                "mp3","ogg","opus","m4a","aac","wav","flac"->{
                    val retriever=MediaMetadataRetriever()
                    try { retriever.setDataSource(file.path);val bytes=retriever.embeddedPicture
                        if(bytes==null||bytes.size>5_000_000)null else decodeSmall(bytes)
                    } finally { retriever.release() }
                }
                "pdf"->ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor->
                    PdfRenderer(descriptor).use { renderer->
                        if(renderer.pageCount==0)null else renderer.openPage(0).use { page->
                            val scale=320f/maxOf(page.width,page.height)
                            Bitmap.createBitmap((page.width*scale).toInt().coerceAtLeast(1),(page.height*scale).toInt().coerceAtLeast(1),Bitmap.Config.ARGB_8888).also { image->
                                image.eraseColor(android.graphics.Color.WHITE);page.render(image,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                            }
                        }
                    }
                }
                else->null
            } ?: return null
            try { ByteArrayOutputStream().use { out->bitmap.compress(Bitmap.CompressFormat.JPEG,75,out);out.toByteArray().takeIf { it.size<=150_000 }?.also { cache.put(key,it) } } }
            finally { bitmap.recycle() }
        }.getOrNull()
    private fun decodeImage(file:File):Bitmap? {
        val options=BitmapFactory.Options().apply { inJustDecodeBounds=true };BitmapFactory.decodeFile(file.path,options)
        if(options.outWidth<=0||options.outHeight<=0)return null
        options.inSampleSize=maxOf(1,maxOf(options.outWidth,options.outHeight)/320);options.inJustDecodeBounds=false
        return BitmapFactory.decodeFile(file.path,options)
    }
    private fun decodeSmall(bytes:ByteArray):Bitmap? {
        val options=BitmapFactory.Options().apply { inJustDecodeBounds=true };BitmapFactory.decodeByteArray(bytes,0,bytes.size,options)
        if(options.outWidth<=0||options.outHeight<=0)return null
        options.inSampleSize=maxOf(1,maxOf(options.outWidth,options.outHeight)/320);options.inJustDecodeBounds=false
        return BitmapFactory.decodeByteArray(bytes,0,bytes.size,options)
    }
    fun token(device:String?,path:String,file:File):String = java.security.MessageDigest.getInstance("SHA-256")
        .digest("$device|$path|${file.length()}|${file.lastModified()}".toByteArray()).joinToString("") { "%02x".format(it) }
}
