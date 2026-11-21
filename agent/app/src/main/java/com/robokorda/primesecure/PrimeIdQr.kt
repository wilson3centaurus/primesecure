package com.robokorda.primesecure

import android.graphics.Bitmap
import android.util.Base64
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import java.io.ByteArrayOutputStream

internal object PrimeIdQr {
    fun dataUri(value: String?): String? {
        val primeId = value?.trim()?.takeIf { it.length in 3..200 } ?: return null
        val matrix = QRCodeWriter().encode(
            primeId,
            BarcodeFormat.QR_CODE,
            320,
            320,
            mapOf(EncodeHintType.MARGIN to 1, EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M),
        )
        val bitmap = Bitmap.createBitmap(matrix.width, matrix.height, Bitmap.Config.ARGB_8888)
        val dark = 0xff1f2a56.toInt()
        val light = 0xffffffff.toInt()
        for (y in 0 until matrix.height) for (x in 0 until matrix.width) {
            bitmap.setPixel(x, y, if (matrix[x, y]) dark else light)
        }
        val bytes = ByteArrayOutputStream().use { output ->
            check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output))
            output.toByteArray()
        }
        bitmap.recycle()
        return "data:image/png;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
    }
}
