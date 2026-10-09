package com.robokorda.primesecure

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import org.json.JSONArray
import org.json.JSONObject

/**
 * The policy's web filter, enforced in two places: Chrome, through its managed
 * configuration (URLBlocklist / URLAllowlist / SafeSearch), and our own School
 * Browser, which reads the same rules from [AgentStore.webFilter].
 */
class WebFilter(
    val mode: String,
    val blocklist: List<String>,
    val allowlist: List<String>,
    val safeSearch: Boolean,
    val homeUrl: String?,
) {
    val active: Boolean get() = mode != "off" || safeSearch || homeUrl != null

    /** Domain rules, Chrome-style: "example.com" covers its subdomains; "*" matches everything. */
    fun allows(url: String): Boolean {
        val uri = Uri.parse(url)
        if (uri.scheme == "about" || uri.scheme == "data") return true
        if (uri.scheme != "http" && uri.scheme != "https") return false
        val host = uri.host?.lowercase() ?: return false
        if (homeUrl != null && Uri.parse(homeUrl).host?.lowercase() == host) return true
        return when (mode) {
            "blocklist" -> blocklist.none { matches(host, it) }
            "allowlist" -> allowlist.any { matches(host, it) }
            else -> true
        }
    }

    /** Adds safe=active to Google searches when SafeSearch is on. */
    fun rewrite(url: String): String {
        if (!safeSearch) return url
        val uri = Uri.parse(url)
        val host = uri.host?.lowercase() ?: return url
        if (!(host.startsWith("google.") || host.contains(".google.")) || uri.path != "/search") return url
        if (uri.getQueryParameter("safe") == "active") return url
        return uri.buildUpon().appendQueryParameter("safe", "active").build().toString()
    }

    private fun matches(host: String, rule: String): Boolean {
        val r = rule.trim().lowercase()
            .substringAfter("://").substringBefore('/').substringBefore(':').removePrefix("*.").removePrefix(".")
        if (r.isEmpty()) return false
        if (r == "*") return true
        return host == r || host.endsWith(".$r")
    }

    fun toJson(): JSONObject = JSONObject()
        .put("mode", mode).put("blocklist", JSONArray(blocklist)).put("allowlist", JSONArray(allowlist))
        .put("safe_search", safeSearch).put("home_url", homeUrl ?: JSONObject.NULL)

    companion object {
        const val CHROME = "com.android.chrome"
        private const val BROWSER_ALIAS = "com.robokorda.primesecure.SchoolBrowser"

        fun fromPolicy(policy: JSONObject) = WebFilter(
            mode = policy.optString("web_filter", "off").ifEmpty { "off" },
            blocklist = policy.stringSet("web_blocklist").toList(),
            allowlist = policy.stringSet("web_allowlist").toList(),
            safeSearch = policy.optBoolean("safe_search", false),
            homeUrl = policy.stringOrNull("browser_home_url"),
        )

        fun fromJson(json: JSONObject?) = if (json == null) WebFilter("off", emptyList(), emptyList(), false, null)
            else fromPolicy(JSONObject()
                .put("web_filter", json.optString("mode", "off"))
                .put("web_blocklist", json.optJSONArray("blocklist") ?: JSONArray())
                .put("web_allowlist", json.optJSONArray("allowlist") ?: JSONArray())
                .put("safe_search", json.optBoolean("safe_search"))
                .put("browser_home_url", json.opt("home_url") ?: JSONObject.NULL))

        /** Applies [filter] to Chrome and the School Browser; returns a one-line summary. */
        fun apply(context: Context, store: AgentStore, filter: WebFilter): String {
            store.webFilter = filter.toJson().toString()

            val restrictions = Bundle()
            when (filter.mode) {
                "blocklist" -> restrictions.putStringArray("URLBlocklist", filter.blocklist.toTypedArray())
                "allowlist" -> {
                    restrictions.putStringArray("URLBlocklist", arrayOf("*"))
                    restrictions.putStringArray("URLAllowlist", filter.allowlist.toTypedArray())
                }
            }
            if (filter.safeSearch) {
                restrictions.putBoolean("ForceGoogleSafeSearch", true)
                restrictions.putInt("ForceYouTubeRestrict", 1) // moderate
            }
            filter.homeUrl?.let {
                restrictions.putString("HomepageLocation", it)
                restrictions.putBoolean("HomepageIsNewTabPage", false)
            }
            AdminReceiver.dpm(context).setApplicationRestrictions(AdminReceiver.component(context), CHROME, restrictions)

            // The School Browser appears in the launcher only while there is something to enforce.
            context.packageManager.setComponentEnabledSetting(
                ComponentName(context.packageName, BROWSER_ALIAS),
                if (filter.active) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP,
            )

            return when (filter.mode) {
                "blocklist" -> "web: ${filter.blocklist.size} site(s) blocked"
                "allowlist" -> "web: only ${filter.allowlist.size} site(s) allowed"
                else -> "web: unfiltered"
            } + if (filter.safeSearch) ", SafeSearch" else ""
        }
    }
}
