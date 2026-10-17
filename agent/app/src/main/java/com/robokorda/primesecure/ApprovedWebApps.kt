package com.robokorda.primesecure

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import org.json.JSONObject

internal object ApprovedWebApps {
    fun restrictWorkers(context: Context,tool:SchoolWebTool?=null) {
        val app=context.applicationContext
        android.webkit.ServiceWorkerController.getInstance().apply {
            serviceWorkerWebSettings.allowFileAccess=false
            serviceWorkerWebSettings.allowContentAccess=false
            setServiceWorkerClient(object:android.webkit.ServiceWorkerClient() {
                override fun shouldInterceptRequest(request:android.webkit.WebResourceRequest):android.webkit.WebResourceResponse? =
                    if(if(tool==null) rules(app).allows(request.url.toString()) else SchoolWebTools.configured(app,tool.id)?.let { rules(app).allows(it.startUrl)&&it.allowsResource(request.url.toString(),rules(app)) }==true) null else android.webkit.WebResourceResponse("text/plain","UTF-8",403,"Not approved",mapOf("Cache-Control" to "no-store"),java.io.ByteArrayInputStream(ByteArray(0)))
            })
        }
    }
    fun rules(context: Context): ApprovedWebRules {
        val filter = runCatching { WebFilter.fromJson(AgentStore(context).webFilter?.let(::JSONObject)) }.getOrNull()
        return ApprovedWebRules(filter?.mode ?: "off", filter?.allowlist ?: emptyList())
    }

    /** Read a wrapper's declared start URL; never infer website approval from its package name. */
    fun startUrl(context: Context, pkg: String): String? {
        val pm = context.packageManager
        val launch = pm.getLaunchIntentForPackage(pkg)?.component ?: return null
        val activity = runCatching { pm.getActivityInfo(launch, PackageManager.GET_META_DATA) }.getOrNull() ?: return null
        val app = runCatching { pm.getApplicationInfo(pkg, PackageManager.GET_META_DATA) }.getOrNull()
        fun url(metadata: Bundle?): String? {
            val raw = metadata?.get("android.support.customtabs.trusted.DEFAULT_URL") ?: return null
            return when(raw) {
                is String -> raw
                is Int -> runCatching { pm.getResourcesForApplication(pkg).getString(raw) }.getOrNull()
                else -> null
            }
        }
        return url(activity.metaData) ?: url(app?.metaData)
    }

    fun open(activity: Activity, item: JSONObject) {
        val pkg = item.getString("package_name")
        check(!AdminReceiver.dpm(activity).isApplicationHidden(AdminReceiver.component(activity),pkg) &&
            !AdminReceiver.dpm(activity).isPackageSuspended(AdminReceiver.component(activity),pkg)) { "This app is blocked by your school." }
        val launch = activity.packageManager.getLaunchIntentForPackage(pkg) ?: error("This app is not installed or is blocked by your school.")
        val url = startUrl(activity, pkg)
        if (url == null) { activity.startActivity(launch); return }
        check(rules(activity).allows(url)) { "Your school needs to approve this app's website in Settings > Web filtering before it can open." }
        activity.startActivity(Intent(activity, WebAppActivity::class.java)
            .setData(android.net.Uri.parse(url)).putExtra("web_app_package", pkg))
    }
}
