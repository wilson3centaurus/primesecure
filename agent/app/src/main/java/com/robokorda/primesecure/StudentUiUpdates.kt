package com.robokorda.primesecure

import android.content.Context
import android.util.Base64
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.concurrent.TimeUnit

/** Signed presentation-only releases. The native bridge stays versioned in the APK. */
object StudentUiUpdates {
    const val ORIGIN = "https://student.primesecure.local/"
    val BUNDLED_VERSION = BuildConfig.UI_BUNDLED_VERSION
    private val names = setOf("index.html","workspace.js","workspace.css","primebook.png","robokorda.jpg")
    private val client = OkHttpClient.Builder().connectTimeout(10,TimeUnit.SECONDS).readTimeout(20,TimeUnit.SECONDS)
        .followRedirects(false).build()

    fun check(context: Context) {
        if(DeviceSafety.updatesPaused(context))return
        val prefs = context.getSharedPreferences("student-ui",Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        if (now - prefs.getLong("last_attempt",0) < 60*60_000L) return
        prefs.edit().putLong("last_attempt",now).apply()
        runCatching {
            client.newCall(Request.Builder().url("https://primesecure-beta.vercel.app/student-ui/release.json").header("Cache-Control","no-cache").build()).execute().use { response ->
                check(response.isSuccessful) { "UI download unavailable" }
                val body = response.body ?: error("Empty UI release")
                val bytes = body.byteStream().use { input ->
                    val out = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
                    while (true) { val n = input.read(buffer); if (n < 0) break; check(out.size()+n <= 2_000_000); out.write(buffer,0,n) }; out.toByteArray()
                }
                val release = verified(context,bytes)
                val version = release.getInt("version")
                if (version <= maxOf(BUNDLED_VERSION,prefs.getInt("highest",0))) return
                val root = File(context.filesDir,"student-ui").apply { mkdirs() }
                val directory = File(root,"v$version").apply { mkdirs() }
                for (name in names) File(directory,name).writeBytes(Base64.decode(release.getJSONObject("files").getString(name),Base64.NO_WRAP))
                File(directory,"signed-release.json").writeBytes(bytes)
                // Publish the pointer only after every verified file is written.
                if(!DeviceSafety.updatesPaused(context))prefs.edit().putInt("highest",version).putInt("active",version).remove("error").commit()
            }
        }.onFailure { prefs.edit().putString("error","Interface update postponed; your saved interface is still available.").apply() }
    }

    private fun verified(context: Context, bytes: ByteArray): JSONObject {
        val envelope = JSONObject(String(bytes,Charsets.UTF_8))
        val payload = Base64.decode(envelope.getString("payload"),Base64.NO_WRAP)
        check(payload.size <= 1_000_000)
        val publicBytes = Base64.decode(context.assets.open("ui-public-key.txt").bufferedReader().use { it.readText().trim() },Base64.NO_WRAP)
        val key = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(publicBytes))
        check(Signature.getInstance("SHA256withRSA").apply { initVerify(key); update(payload) }.verify(Base64.decode(envelope.getString("signature"),Base64.NO_WRAP))) { "Invalid UI signature" }
        return JSONObject(String(payload,Charsets.UTF_8)).also { release ->
            check(release.getInt("bridge") == 1 && release.getInt("version") > 0)
            check(release.getJSONObject("files").keys().asSequence().toSet() == names)
        }
    }

    @Synchronized fun begin(context: Context): File? {
        DeviceSafety.finishRollback(context)
        val prefs = context.getSharedPreferences("student-ui",Context.MODE_PRIVATE)
        val active = prefs.getInt("active",0)
        // A prior process died before the JS readiness handshake. Fall back on next opening.
        if (active <= BUNDLED_VERSION) return null
        if (prefs.getInt("probation",0) == active) { reject(context); return begin(context) }
        return runCatching {
            val dir = File(context.filesDir,"student-ui/v$active")
            val release = verified(context,File(dir,"signed-release.json").readBytes())
            check(release.getInt("version") == active)
            for (name in names) check(File(dir,name).readBytes().contentEquals(Base64.decode(release.getJSONObject("files").getString(name),Base64.NO_WRAP)))
            prefs.edit().putInt("probation",active).commit(); dir
        }.getOrElse { reject(context); begin(context) }
    }
    fun accept(context: Context) {
        val prefs = context.getSharedPreferences("student-ui",Context.MODE_PRIVATE)
        val tested = prefs.getInt("probation",0)
        if (tested > BUNDLED_VERSION && tested!=prefs.getInt("good",0)) prefs.edit().putInt("previous",prefs.getInt("good",0)).putInt("good",tested).remove("probation").commit()
        else prefs.edit().remove("probation").commit()
        // Retain the current and prior working UI only. No student resources live here.
        val keep = setOf(prefs.getInt("active",0),prefs.getInt("good",0),prefs.getInt("previous",0))
        val root = File(context.filesDir,"student-ui")
        root.listFiles()?.filter { it.isDirectory && it.name.matches(Regex("v[0-9]+")) && it.name.drop(1).toIntOrNull() !in keep }?.forEach { dir ->
            (names + "signed-release.json").forEach { File(dir,it).delete() }; dir.delete()
        }
    }
    fun reject(context: Context) {
        val prefs = context.getSharedPreferences("student-ui",Context.MODE_PRIVATE)
        val good = prefs.getInt("good",0)
        val active=prefs.getInt("active",0)
        val candidate = if (good != active) good else prefs.getInt("previous",0)
        val fallback=if(candidate!=active)candidate else 0
        prefs.edit().putInt("active",fallback).remove("probation").commit()
        // Prevent a corrupt prior release from being selected repeatedly.
        if (fallback == good) prefs.edit().putInt("good",0).commit()
        else prefs.edit().putInt("previous",0).commit()
    }
}
