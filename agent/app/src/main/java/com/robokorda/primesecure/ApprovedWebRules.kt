package com.robokorda.primesecure

import java.net.URI
import java.util.Locale

/** Deliberately stricter than the legacy browser: no implicit home-page exemption. */
internal class ApprovedWebRules(mode: String, domains: List<String>) {
    private val hosts = if (mode == "allowlist") domains.mapNotNull(::hostRule).toSet() else emptySet()
    val enabled get() = hosts.isNotEmpty()

    fun allows(url: String): Boolean = runCatching {
        val uri = URI(url)
        val host = uri.host?.lowercase(Locale.ROOT) ?: return false
        uri.scheme.equals("https", true) && uri.rawUserInfo == null && uri.port in setOf(-1, 443) &&
            hosts.any { host == it || host.endsWith(".$it") }
    }.getOrDefault(false)

    private fun hostRule(input: String): String? = runCatching {
        val rule = input.trim().lowercase(Locale.ROOT).removePrefix("*.").removePrefix(".")
        val uri = URI(if (rule.contains("://")) rule else "https://$rule")
        uri.host?.takeIf { uri.scheme == "https" && uri.rawUserInfo == null && uri.port in setOf(-1, 443) &&
            it.contains('.') && !it.endsWith('.') && it.none { c -> c == '*' } }
    }.getOrNull()
}
