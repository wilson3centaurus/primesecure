package com.robokorda.primesecure

import android.content.Context
import android.graphics.BitmapFactory
import android.widget.ImageView
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.File

object HubImages {
    fun preview(context: Context, item: JSONObject, scope: CoroutineScope): ImageView {
        val view = ImageView(context).apply {
            contentDescription = item.optString("title")
            adjustViewBounds = true
            maxHeight = (240 * resources.displayMetrics.density).toInt()
        }
        scope.launch {
            runCatching { withContext(Dispatchers.IO) {
                val file = File(context.cacheDir, "wallpaper-${java.util.UUID.fromString(item.getString("id"))}")
                if (!file.exists()) {
                    val part = File(file.path + ".part")
                    try {
                        SupabaseApi(AgentStore(context)).download("/storage/v1/object/primesecure-hub/${item.getString("storage_path")}", part)
                        check(part.renameTo(file))
                    } finally { part.delete() }
                }
                val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(file.path, options)
                options.inSampleSize = maxOf(1, maxOf(options.outWidth, options.outHeight) / 800)
                options.inJustDecodeBounds = false
                BitmapFactory.decodeFile(file.path, options)
            } }.onSuccess { view.setImageBitmap(it) }
        }
        return view
    }
}
