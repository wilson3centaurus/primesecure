package com.robokorda.primesecure

import java.net.URI
import java.util.Locale

/** Curated entry points, kept separate from the privileged student WebView. */
internal data class SchoolWebTool(
    val id:String, val title:String, val startUrl:String,
    private val resources:List<String>, private val downloads:List<String>, val imagesOnly:Boolean=false
) {
    private val resourceRules=ApprovedWebRules("allowlist",resources)
    private val downloadRules=ApprovedWebRules("allowlist",downloads)
    private val navigationRules=ApprovedWebRules("allowlist",listOf(URI(startUrl).host))
    private fun advertising(host:String)=listOf("abscloud.org","rolledipocras.com","crn77.com").any { host==it || host.endsWith(".$it") }
    fun allowsNavigation(url:String)=navigationRules.allows(url)
    fun allowsResource(url:String,school:ApprovedWebRules):Boolean {
        val uri=runCatching { URI(url) }.getOrNull() ?: return false
        val host=uri.host?.lowercase(Locale.ROOT) ?: return false
        if(advertising(host))return false
        // Metadata only, without granting the YouTube website or its player.
        if(host=="www.youtube.com"&&uri.path=="/oembed")return ApprovedWebRules("allowlist",listOf(host)).allows(url)
        return resourceRules.allows(url)||school.allows(url)
    }
    fun allowsDownload(url:String,school:ApprovedWebRules)=!advertising(runCatching { URI(url).host?.lowercase(Locale.ROOT) }.getOrNull() ?: "")&&(downloadRules.allows(url)||school.allows(url))
}

internal object SchoolWebTools {
    val all=listOf(
        SchoolWebTool("music","Music & videos","https://v4.mp3juices.africa.com/",
            listOf("v4.mp3juices.africa.com","api.ytmp3.tube","us-central1-ytmp3-tube.cloudfunctions.net","ytimg.com","suggestqueries.google.com"),
            listOf("v4.mp3juices.africa.com","ytmp3.tube","googlevideo.com")),
        SchoolWebTool("images","Image search","https://unsplash.com/",
            listOf("unsplash.com","images.unsplash.com","plus.unsplash.com"),
            listOf("unsplash.com","images.unsplash.com","plus.unsplash.com"),imagesOnly=true)
    )
    fun find(id:String)=all.find { it.id==id }
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
