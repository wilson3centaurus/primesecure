package com.robokorda.primesecure

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import org.json.JSONObject

/** Keep school-selected viewers first in PrimeSecure and Android's default resolver. */
object PreferredViewers {
    private val types=mapOf(
        "images" to listOf("image/*"), "videos" to listOf("video/*"), "music" to listOf("audio/*"),
        "books" to listOf("application/pdf","application/epub+zip"),
        "documents" to listOf("application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.oasis.opendocument.text","text/plain")
    )
    fun apply(context: Context, management: JSONObject) {
        val dpm=AdminReceiver.dpm(context);val admin=AdminReceiver.component(context)
        val prefs=context.getSharedPreferences("preferred-viewers",Context.MODE_PRIVATE)
        val requested=management.optJSONObject("viewer_packages") ?: JSONObject()
        val approved=management.stringSet("approved_packages")
        val next=JSONObject()
        for(kind in types.keys) requested.optString(kind).takeIf { it.isNotBlank() && it in approved }?.let { next.put(kind,it) }
        val previous=JSONObject(prefs.getString("applied","{}")!!)
        if(previous.toString()!=next.toString()) {
            previous.keys().asSequence().map { previous.getString(it) }.toSet().forEach { dpm.clearPackagePersistentPreferredActivities(admin,it) }
        }
        val applied=JSONObject()
        for((kind,mimes) in types) {
            val pkg=next.optString(kind).takeIf { it.isNotBlank() } ?: continue
            var count=0
            for(mime in mimes) {
                val intent=Intent(Intent.ACTION_VIEW).addCategory(Intent.CATEGORY_DEFAULT)
                    .setDataAndType(Uri.parse("content://${context.packageName}.resources/viewer-test"),mime).setPackage(pkg)
                val activity=context.packageManager.queryIntentActivities(intent,0).firstOrNull()?.activityInfo ?: continue
                val filter=IntentFilter(Intent.ACTION_VIEW).apply { addCategory(Intent.CATEGORY_DEFAULT);addDataScheme("content");addDataType(mime) }
                dpm.addPersistentPreferredActivity(admin,filter,ComponentName(pkg,activity.name));count++
            }
            if(count>0)applied.put(kind,pkg)
        }
        prefs.edit().putString("applied",applied.toString()).apply()
    }
    fun clear(context: Context) {
        val prefs=context.getSharedPreferences("preferred-viewers",Context.MODE_PRIVATE)
        val applied=JSONObject(prefs.getString("applied","{}")!!)
        applied.keys().asSequence().map { applied.getString(it) }.toSet().forEach {
            AdminReceiver.dpm(context).clearPackagePersistentPreferredActivities(AdminReceiver.component(context),it)
        }
        prefs.edit().clear().apply()
    }
}
