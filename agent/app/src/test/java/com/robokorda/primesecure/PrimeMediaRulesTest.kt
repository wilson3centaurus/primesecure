package com.robokorda.primesecure
import org.junit.Assert.*
import org.junit.Test
class PrimeMediaRulesTest {
    @Test fun localPlayerAndExactEmbedAreTheOnlyAllowedPages(){
        val id="abcdefghijk";val app="com.robokorda.primesecure"
        assertTrue(PrimeMediaRules.playerPage("https://$app/prime-media/player/$id",id,app))
        assertTrue(PrimeMediaRules.playerPage("https://www.youtube-nocookie.com/embed/$id?origin=https://$app",id,app))
        for(url in listOf("https://$app/","https://www.youtube.com/watch?v=$id","https://www.youtube.com/embed/zzzzzzzzzzz","https://$app.evil.test/prime-media/player/$id","http://$app/prime-media/player/$id","https://user@$app/prime-media/player/$id"))assertFalse(url,PrimeMediaRules.playerPage(url,id,app))
    }
    @Test fun onlyVideoIdentifiersReachThePlayer(){assertTrue(PrimeMediaRules.videoId("dQw4w9WgXcQ"));assertFalse(PrimeMediaRules.videoId("../settings"));assertFalse(PrimeMediaRules.videoId("https://youtube.com"))}
    @Test fun embeddedVideoCannotNavigateToGeneralYouTube(){val id="dQw4w9WgXcQ";assertTrue(PrimeMediaRules.playerResource("https://www.youtube-nocookie.com/embed/$id?origin=https://com.robokorda.primesecure",id));assertFalse(PrimeMediaRules.playerResource("https://www.youtube.com/embed/aaaaaaaaaaa",id));assertFalse(PrimeMediaRules.playerResource("https://www.youtube.com/results?search_query=test",id));assertFalse(PrimeMediaRules.playerResource("https://www.youtube.com/watch?v=$id",id))}
    @Test fun resourcesRequireExactGoogleHostsAndHttps(){val id="dQw4w9WgXcQ";assertTrue(PrimeMediaRules.playerResource("https://r3.googlevideo.com/videoplayback",id));assertFalse(PrimeMediaRules.playerResource("https://googlevideo.com.evil.test/a",id));assertFalse(PrimeMediaRules.playerResource("file:///sdcard/test.html",id));assertFalse(PrimeMediaRules.playerResource("intent://youtube",id));assertFalse(PrimeMediaRules.playerResource("https://user@ytimg.com/a",id))}
}
