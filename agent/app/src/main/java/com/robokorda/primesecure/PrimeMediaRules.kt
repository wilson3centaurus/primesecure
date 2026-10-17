package com.robokorda.primesecure

import java.net.URI

internal object PrimeMediaRules {
    fun videoId(value:String)=value.matches(Regex("[A-Za-z0-9_-]{11}"))
    fun playerPage(value:String,video:String,appId:String):Boolean=runCatching {
        val uri=URI(value)
        uri.scheme=="https"&&uri.rawUserInfo==null&&uri.port in setOf(-1,443)&&
            ((uri.host==appId&&uri.path=="/prime-media/player/$video")||
             (uri.host in setOf("www.youtube.com","www.youtube-nocookie.com")&&uri.path=="/embed/$video"))
    }.getOrDefault(false)
    fun playerResource(value:String,video:String):Boolean=runCatching {
        val uri=URI(value);val host=uri.host ?: return false
        if(!uri.scheme.equals("https",true)||uri.rawUserInfo!=null||uri.port !in setOf(-1,443))return false
        if(host in setOf("www.youtube.com","www.youtube-nocookie.com")) {
            if(uri.path.startsWith("/embed/"))return uri.path=="/embed/$video"
            return uri.path in setOf("/iframe_api","/generate_204","/error_204","/get_video_info","/ptracking")||listOf("/s/","/youtubei/","/api/","/pagead/").any { uri.path.startsWith(it) }
        }
        listOf("googlevideo.com","ytimg.com","gstatic.com","ggpht.com").any { host==it||host.endsWith(".$it") }||host in setOf("youtubei.googleapis.com","jnn-pa.googleapis.com","googleads.g.doubleclick.net","static.doubleclick.net","www.googleadservices.com","pagead2.googlesyndication.com")
    }.getOrDefault(false)
}
