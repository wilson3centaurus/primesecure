package com.robokorda.primesecure

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Color
import android.widget.*
import kotlinx.coroutines.*
import okhttp3.Request
import org.json.JSONObject

/** Inert rich content: text, headings, pipe tables and an image; never executes HTML or JS. */
object MessageContent {
    fun render(context: Context, parent: LinearLayout, payload: JSONObject, scope: CoroutineScope) {
        payload.optString("body").lines().forEach { line ->
            if (line.trim().startsWith('|') && line.count { it == '|' } >= 2) {
                val cells = line.trim().trim('|').split('|')
                if (cells.all { it.trim().matches(Regex("[: -]+")) }) return@forEach
                val row = LinearLayout(context)
                cells.forEach { cell -> row.addView(TextView(context).apply {
                    text = cell.trim(); textSize = 16f; setPadding(12, 12, 12, 12)
                    setBackgroundColor(Color.rgb(237, 241, 250))
                }, LinearLayout.LayoutParams(0, -2, 1f)) }
                parent.addView(row)
            } else parent.addView(TextView(context).apply {
                text = line.removePrefix("# "); textSize = if (line.startsWith("# ")) 24f else 18f
                setTextColor(Color.rgb(25, 37, 68)); setPadding(0, 6, 0, 6); setTextIsSelectable(true)
            })
        }
        val url = payload.optString("image_url")
        val privatePath = payload.stringOrNull("image_path")
        if (url.startsWith("https://") || privatePath != null) {
            val image = ImageView(context).apply { adjustViewBounds = true; contentDescription = "Message attachment" }
            parent.addView(image)
            scope.launch {
                runCatching { withContext(Dispatchers.IO) {
                    val name = java.security.MessageDigest.getInstance("SHA-256").digest((privatePath ?: url).toByteArray()).joinToString("") { "%02x".format(it) }
                    val cached = java.io.File(context.filesDir, "message-image-$name")
                    if (!cached.exists() && privatePath != null) {
                        val part = java.io.File(cached.path + ".part")
                        try {
                            SupabaseApi(AgentStore(context)).download("/storage/v1/object/primesecure-messages/$privatePath", part)
                            check(part.length() <= 8_000_000) { "Image too large" }
                            check(part.renameTo(cached))
                        } finally { part.delete() }
                    }
                    val bytes = if (cached.exists()) cached.readBytes() else SupabaseApi.http.newCall(Request.Builder().url(url).build()).execute().use { response ->
                        check(response.isSuccessful)
                        val body = response.body ?: error("Missing image")
                        require(body.contentLength() in 1..8_000_000) { "Image too large" }
                        body.bytes().also { cached.writeBytes(it) }
                    }
                        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                        options.inSampleSize = maxOf(1, maxOf(options.outWidth, options.outHeight) / 1600)
                        options.inJustDecodeBounds = false
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                } }.onSuccess { image.setImageBitmap(it) }.onFailure {
                    parent.addView(TextView(context).apply { text = "Image unavailable. Reopen this message when online." })
                }
            }
        }
    }
}
