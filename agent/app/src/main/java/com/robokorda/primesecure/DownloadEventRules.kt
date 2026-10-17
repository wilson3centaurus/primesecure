package com.robokorda.primesecure

import java.net.URI
import java.util.Locale

/** Domains include subdomains; full HTTPS URLs are exact-host path prefixes. */
internal class DownloadEventRules(private val entries:List<String>) {
    fun allows(url:String):Boolean = runCatching {
        val target=URI(url)
        if(!safe(target))return false
        entries.any { value ->
            runCatching entry@ {
                val full=value.contains("://")
                val rule=URI(if(full)value.trim() else "https://${value.trim()}")
                if(!safe(rule)||rule.rawFragment!=null||(!full&&rule.rawPath !in listOf("","/")))return@entry false
                val host=target.host.lowercase(Locale.ROOT);val wanted=rule.host.lowercase(Locale.ROOT)
                val hostMatch=host==wanted||(!full&&host.endsWith(".$wanted"))
                val path=(rule.path ?: "").trimEnd('/')
                hostMatch&&(!full||path.isEmpty()||target.path==path||target.path.startsWith("$path/"))
            }.getOrDefault(false)
        }
    }.getOrDefault(false)
    private fun safe(uri:URI)=uri.scheme.equals("https",true)&&uri.host?.contains('.')==true&&
        uri.rawUserInfo==null&&uri.port in setOf(-1,443)&&!uri.host.endsWith('.')&&
        uri.host.none { it=='*' }&&!uri.host.matches(Regex("\\d+(\\.\\d+){3}"))&&
        !uri.host.endsWith(".local")&&!uri.host.endsWith(".internal")&&
        uri.rawPath?.let { !it.contains('\\')&&!Regex("(?i)%2f|%5c|%2e").containsMatchIn(it)&&uri.normalize().path==uri.path }!=false
}

internal object DownloadPopupRules {
    fun mayCapture(tool:Boolean,approved:Boolean,pending:Boolean,gesture:Boolean,now:Long,lastInteraction:Long)=
        tool&&approved&&!pending&&(gesture||(lastInteraction>0&&now>=lastInteraction&&now-lastInteraction<=10_000))
}
