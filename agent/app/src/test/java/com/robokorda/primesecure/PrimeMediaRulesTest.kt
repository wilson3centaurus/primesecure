package com.robokorda.primesecure
import org.junit.Assert.*
import org.junit.Test
class PrimeMediaRulesTest {
    @Test fun onlyVideoIdentifiersReachThePlayer(){assertTrue(PrimeMediaRules.videoId("dQw4w9WgXcQ"));assertFalse(PrimeMediaRules.videoId("../settings"));assertFalse(PrimeMediaRules.videoId("https://youtube.com"))}
    @Test fun embeddedVideoCannotNavigateToGeneralYouTube(){val id="dQw4w9WgXcQ";assertTrue(PrimeMediaRules.playerResource("https://www.youtube-nocookie.com/embed/$id?origin=https://com.robokorda.primesecure",id));assertFalse(PrimeMediaRules.playerResource("https://www.youtube.com/embed/aaaaaaaaaaa",id));assertFalse(PrimeMediaRules.playerResource("https://www.youtube.com/results?search_query=test",id));assertFalse(PrimeMediaRules.playerResource("https://www.youtube.com/watch?v=$id",id))}
    @Test fun resourcesRequireExactGoogleHostsAndHttps(){val id="dQw4w9WgXcQ";assertTrue(PrimeMediaRules.playerResource("https://r3.googlevideo.com/videoplayback",id));assertFalse(PrimeMediaRules.playerResource("https://googlevideo.com.evil.test/a",id));assertFalse(PrimeMediaRules.playerResource("file:///sdcard/test.html",id));assertFalse(PrimeMediaRules.playerResource("intent://youtube",id));assertFalse(PrimeMediaRules.playerResource("https://user@ytimg.com/a",id))}
}
