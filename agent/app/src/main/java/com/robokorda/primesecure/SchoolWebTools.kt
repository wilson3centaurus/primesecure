package com.robokorda.primesecure

import java.net.URI
import java.util.Locale

/** Curated entry points, kept separate from the privileged student WebView. */
internal data class SchoolWebTool(
    val id:String, val title:String, val startUrl:String,
    val resources:List<String>, val downloads:List<String>, val imagesOnly:Boolean=false,
    val pages:List<String> = emptyList()
) {
    private val resourceRules=DownloadEventRules(listOf("https://${URI(startUrl).host}/")+resources+pages)
    private val downloadRules=DownloadEventRules(listOf("https://${URI(startUrl).host}/")+downloads)
    private val navigationRules=DownloadEventRules(listOf("https://${URI(startUrl).host}/")+pages)
    private fun advertising(host:String)=listOf("abscloud.org","rolledipocras.com","crn77.com","omg10.com","extroverted-roll.com").any { host==it || host.endsWith(".$it") }
    fun allowsNavigation(url:String)=!advertising(runCatching { URI(url).host?.lowercase(Locale.ROOT) }.getOrNull() ?: "")&&navigationRules.allows(url)
    fun allowsResource(url:String,school:ApprovedWebRules):Boolean {
        val uri=runCatching { URI(url) }.getOrNull() ?: return false
        val host=uri.host?.lowercase(Locale.ROOT) ?: return false
        if(advertising(host)||!school.allows(startUrl))return false
        // Metadata only, without granting the YouTube website or its player.
        if(host=="www.youtube.com"&&uri.path=="/oembed")return ApprovedWebRules("allowlist",listOf(host)).allows(url)
        return resourceRules.allows(url)
    }
    fun allowsDownload(url:String,school:ApprovedWebRules)=school.allows(startUrl)&&!advertising(runCatching { URI(url).host?.lowercase(Locale.ROOT) }.getOrNull() ?: "")&&downloadRules.allows(url)
}

internal object SchoolWebTools {
    val all=listOf(
        SchoolWebTool("music","Music & videos","https://v4.mp3juices.africa.com/",
            listOf("v4.mp3juices.africa.com","api.ytmp3.tube","us-central1-ytmp3-tube.cloudfunctions.net","ytimg.com","suggestqueries.google.com"),
            listOf("v4.mp3juices.africa.com","ytmp3.tube","googlevideo.com"),
            pages=listOf("https://api.ytmp3.tube/mp3","https://api.ytmp3.tube/mp4")),
        SchoolWebTool("images","Image search","https://unsplash.com/",
            listOf("unsplash.com","images.unsplash.com","plus.unsplash.com"),
            listOf("unsplash.com","images.unsplash.com","plus.unsplash.com"),imagesOnly=true)
    )
    fun find(id:String)=all.find { it.id==id }
    fun configured(context:android.content.Context,id:String):SchoolWebTool? {
        val base=find(id) ?: return null
        val config=runCatching { org.json.JSONObject(AgentStore(context).webFilter ?: "{}").optJSONObject("download_rules")?.optJSONObject(id) }.getOrNull() ?: return base
        fun list(key:String,fallback:List<String>):List<String> {
            val array=config.optJSONArray(key) ?: return fallback
            return (0 until minOf(40,array.length())).mapNotNull { array.optString(it).trim().takeIf { s->s.isNotEmpty()&&s.length<=1000 } }
        }
        val start=config.optString("start_url",base.startUrl)
        if(!DownloadEventRules(listOf(start)).allows(start))return base
        return base.copy(startUrl=start,pages=list("pages",base.pages),resources=list("resources",base.resources),downloads=list("downloads",base.downloads))
    }
}

/** Recognise supported media; filenames and a website's MIME claim are insufficient. */
internal object WebMediaRules {
    data class Format(val mime:String,val extension:String)
    fun identify(bytes:ByteArray,header:String,imagesOnly:Boolean):Format? {
        fun at(offset:Int,text:String)=bytes.size>=offset+text.length && text.indices.all { bytes[offset+it].toInt() and 255==text[it].code }
        val type=header.substringBefore(';').trim().lowercase(Locale.ROOT)
        if(type.startsWith("text/")||type in setOf("application/pdf","application/zip","application/vnd.android.package-archive","image/svg+xml"))return null
        val image=when {
            bytes.size>=3&&bytes[0].toInt() and 255==255&&bytes[1].toInt() and 255==216&&bytes[2].toInt() and 255==255->Format("image/jpeg","jpg")
            bytes.size>=8&&bytes.take(8)==listOf(137,80,78,71,13,10,26,10).map(Int::toByte)->Format("image/png","png")
            at(0,"GIF87a")||at(0,"GIF89a")->Format("image/gif","gif")
            at(0,"RIFF")&&at(8,"WEBP")->Format("image/webp","webp")
            else->null
        }
        if(image!=null)return if(imagesOnly)image else null
        if(imagesOnly)return null
        return when {
            at(0,"ID3")||bytes.size>=2&&bytes[0].toInt() and 255==255&&bytes[1].toInt() and 224==224->Format("audio/mpeg","mp3")
            at(0,"RIFF")&&at(8,"WAVE")->Format("audio/wav","wav")
            at(0,"OggS")->Format("audio/ogg","ogg")
            at(4,"ftyp")->if(type.startsWith("audio/")||at(8,"M4A "))Format("audio/mp4","m4a") else Format("video/mp4","mp4")
            bytes.size>=4&&bytes.take(4)==listOf(26,69,223,163).map(Int::toByte)->if(type.startsWith("audio/"))Format("audio/webm","webm") else Format("video/webm","webm")
            else->null
        }
    }
    fun safeName(suggested:String,extension:String):String {
        val leaf=suggested.substringAfterLast('/').substringAfterLast('\\').substringBeforeLast('.',suggested.substringAfterLast('/').substringAfterLast('\\'))
            .replace(Regex("[\\p{Cntrl}\\/:*?\"<>|]"),"_").trim(' ','.').take(90).ifBlank { "School download" }
        return "$leaf.$extension"
    }
}
