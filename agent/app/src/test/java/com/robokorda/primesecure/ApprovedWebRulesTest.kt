package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Test

class ApprovedWebRulesTest {
    private val rules=ApprovedWebRules("allowlist", listOf("tinkercad.com","https://accounts.autodesk.com/","*.cdn.example.org"))
    @Test fun `approved HTTPS sites and subdomains work`() {
        listOf("https://www.tinkercad.com/","https://tinkercad.com/classrooms?code=ABC","https://editor.tinkercad.com/design","https://accounts.autodesk.com/login","https://a.cdn.example.org/x.js","https://tinkercad.com:443/").forEach { assertTrue(it,rules.allows(it)) }
    }
    @Test fun `lookalikes credential tricks and other domains are denied`() {
        listOf("https://tinkercad.com.attacker.org/","https://eviltinkercad.com/","https://tinkercad.com@google.com/","https://user@tinkercad.com/","https://google.com/search?q=math","https://autodesk.com/","https://tinkercad.com:8443/","https://tinkercad.com./","https://tinkercad.com%2e.evil.com/").forEach { assertFalse(it,rules.allows(it)) }
    }
    @Test fun `external app local file data script and HTTP schemes cannot escape`() {
        listOf("http://tinkercad.com/","intent://tinkercad.com/#Intent;scheme=https;end","file:///sdcard/browser.html","content://documents/1","javascript:alert(1)","data:text/html,<script></script>","about:blank","blob:https://tinkercad.com/123","https://","").forEach { assertFalse(it,rules.allows(it)) }
    }
    @Test fun `off blocklist empty and wildcard lists fail closed`() {
        listOf(ApprovedWebRules("off",listOf("tinkercad.com")),ApprovedWebRules("blocklist",listOf("tinkercad.com")),ApprovedWebRules("allowlist",emptyList()),ApprovedWebRules("allowlist",listOf("*","https://*","localhost","http://tinkercad.com"))).forEach { assertFalse(it.enabled);assertFalse(it.allows("https://tinkercad.com/")) }
    }
    @Test fun `policy replacement revokes sites without an implicit home exemption`() {
        assertTrue(rules.allows("https://tinkercad.com/"))
        assertFalse(ApprovedWebRules("allowlist",listOf("wokwi.com")).allows("https://tinkercad.com/"))
    }
}
