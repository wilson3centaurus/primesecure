package com.robokorda.primesecure

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import java.io.ByteArrayOutputStream

/** Student-selected images only. Re-encode without EXIF and bound decoded memory/payload. */
object AttachmentImages {
    fun read(context: Context, uri: Uri): String {
        val options=BitmapFactory.Options().apply { inJustDecodeBounds=true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it,null,options) }
        require(options.outWidth>0&&options.outHeight>0) { "Choose a valid image or screenshot." }
        options.inJustDecodeBounds=false
        var sample=1
        while(maxOf(options.outWidth,options.outHeight)/sample>1400)sample*=2
        options.inSampleSize=sample
        var bitmap=context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it,null,options) }
            ?: error("Could not open that image.")
        try {
            repeat(7) {
                val out=ByteArrayOutputStream()
                bitmap.compress(Bitmap.CompressFormat.JPEG,76,out)
                if(out.size()<=74000)return "data:image/jpeg;base64,"+Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP)
                val smaller=Bitmap.createScaledBitmap(bitmap,maxOf(1,bitmap.width*3/4),maxOf(1,bitmap.height*3/4),true)
                if(smaller!==bitmap)bitmap.recycle()
                bitmap=smaller
            }
            error("Choose a smaller image or crop the screenshot first.")
        } finally {bitmap.recycle()}
    }
}
