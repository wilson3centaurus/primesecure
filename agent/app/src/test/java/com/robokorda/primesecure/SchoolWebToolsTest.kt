package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Test

class SchoolWebToolsTest {
    private val school=ApprovedWebRules("allowlist",listOf("unsplash.com","v4.mp3juices.africa.com"))
    @Test fun `entry approval does not provide an address bar or outside navigation`() {
        val images=SchoolWebTools.find("images")!!
        assertTrue(images.allowsNavigation("https://unsplash.com/s/photos/flowers"))
        listOf("https://google.com/","https://unsplash.com.evil.test/","https://unsplash.com@evil.test/","file:///sdcard/test.html","javascript:alert(1)","http://unsplash.com/","https://unsplash.com:8080/").forEach { assertFalse(it,images.allowsNavigation(it)) }
        assertTrue(images.allowsResource("https://images.unsplash.com/photo-example?fm=jpg",school))
        assertTrue(images.allowsDownload("https://images.unsplash.com/photo-example?dl=image.jpg",school))
        assertFalse(images.allowsDownload("https://unapproved.test/file.mp3",school))
    }
    @Test fun `music resources exclude advertising and unrestricted youtube`() {
        val music=SchoolWebTools.find("music")!!
        assertTrue(music.allowsResource("https://us-central1-ytmp3-tube.cloudfunctions.net/searchResult?q=music",school))
        assertTrue(music.allowsResource("https://www.youtube.com/oembed?url=test&format=json",school))
        assertFalse(music.allowsResource("https://www.youtube.com/watch?v=test",school))
        listOf("https://abscloud.org/ad.js","https://qw.rolledipocras.com/test","https://crn77.com/4/advert","https://evil.cloudfunctions.net/").forEach { assertFalse(it,music.allowsResource(it,school)) }
    }
    @Test fun `file signatures reject renamed apps html and unsupported documents`() {
        val png=byteArrayOf(137.toByte(),80,78,71,13,10,26,10)
        assertEquals("image/png",WebMediaRules.identify(png,"image/png",true)?.mime)
        assertNull(WebMediaRules.identify(png,"image/png",false))
        assertEquals("audio/mpeg",WebMediaRules.identify("ID3example".toByteArray(),"application/octet-stream",false)?.mime)
        assertNull(WebMediaRules.identify("ID3example".toByteArray(),"text/html",false))
        assertNull(WebMediaRules.identify("PK\u0003\u0004apk".toByteArray(),"audio/mpeg",false))
        assertNull(WebMediaRules.identify("<html>download</html>".toByteArray(),"image/jpeg",true))
        assertNull(WebMediaRules.identify("%PDF-1.7".toByteArray(),"application/pdf",true))
        assertNull(WebMediaRules.identify("ID3example".toByteArray(),"audio/mpeg",true))
        assertNull(WebMediaRules.identify("<svg onload='bad'>".toByteArray(),"image/svg+xml",true))
    }
    @Test fun `media filenames cannot keep an executable suffix or escape a folder`() {
        assertEquals("lesson.mp3",WebMediaRules.safeName("../../lesson.apk","mp3"))
        assertEquals("photo.jpg",WebMediaRules.safeName("C:\\Downloads\\photo.html","jpg"))
        assertEquals("School download.mp4",WebMediaRules.safeName("..","mp4"))
    }
}
