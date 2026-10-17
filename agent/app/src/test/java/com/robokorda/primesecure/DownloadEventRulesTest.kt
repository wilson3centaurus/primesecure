package com.robokorda.primesecure
import org.junit.Assert.*
import org.junit.Test
class DownloadEventRulesTest {
    @Test fun fullUrlsConstrainHostAndPathButNotVideoQuery() {
        assertTrue(SchoolWebTools.find("music")!!.allowsNavigation("https://api.ytmp3.tube/mp3?url=test"))
        assertTrue(SchoolWebTools.find("music")!!.allowsNavigation("https://api.ytmp3.tube/mp4?url=test"))
        val rules=DownloadEventRules(listOf("https://converter.example.org/preview"))
        assertTrue(rules.allows("https://converter.example.org/preview?url=https%3A%2F%2Fexample.org"))
        assertTrue(rules.allows("https://converter.example.org/preview/ready?id=12"))
        listOf("https://converter.example.org/search","https://converter.example.org/preview-evil","https://child.converter.example.org/preview","https://converter.example.org/preview/../search","https://converter.example.org/preview/%2e%2e/search","http://converter.example.org/preview","https://converter.example.org:8443/preview","https://converter.example.org@evil.test/preview","javascript:alert(1)").forEach { assertFalse(it,rules.allows(it)) }
    }
    @Test fun pagePermissionIsSeparateFromFileAndSupportingHosts() {
        val school=ApprovedWebRules("allowlist",listOf("v4.mp3juices.africa.com"))
        val tool=SchoolWebTools.find("music")!!.copy(pages=listOf("https://preview.example.org/convert"),resources=listOf("static.example.org"),downloads=listOf("cdn.example.org"))
        assertTrue(tool.allowsNavigation("https://preview.example.org/convert?id=1"))
        assertFalse(tool.allowsNavigation("https://cdn.example.org/song.mp3"))
        assertTrue(tool.allowsDownload("https://edge.cdn.example.org/song.mp3",school))
        assertFalse(tool.allowsDownload("https://preview.example.org/convert",school))
        assertTrue(tool.allowsResource("https://static.example.org/app.js",school))
        assertFalse(tool.allowsResource("https://another.example.org/app.js",school))
        assertFalse(DownloadEventRules(listOf("cdn.example.org/path")).allows("https://cdn.example.org/anything"))
    }
    @Test fun advertisingRemainsBlockedEvenIfAccidentallyListed() {
        val school=ApprovedWebRules("allowlist",listOf("v4.mp3juices.africa.com"))
        for(host in listOf("omg10.com","extroverted-roll.com","crn77.com")) {
            val tool=SchoolWebTools.find("music")!!.copy(pages=listOf(host),resources=listOf(host),downloads=listOf(host))
            assertFalse(tool.allowsNavigation("https://$host/4/10084450"))
            assertFalse(tool.allowsResource("https://$host/ad.js",school))
            assertFalse(tool.allowsDownload("https://$host/audio.mp3",school))
        }
    }
    @Test fun popupCaptureRequiresAnApprovedDownloadToolAndRecentInteraction() {
        assertTrue(DownloadPopupRules.mayCapture(true,true,false,true,50_000,0))
        assertTrue(DownloadPopupRules.mayCapture(true,true,false,false,50_000,45_000))
        assertFalse(DownloadPopupRules.mayCapture(true,true,false,false,50_000,1_000))
        assertFalse(DownloadPopupRules.mayCapture(false,true,false,true,50_000,49_000))
        assertFalse(DownloadPopupRules.mayCapture(true,false,false,true,50_000,49_000))
        assertFalse(DownloadPopupRules.mayCapture(true,true,true,true,50_000,49_000))
    }
}
