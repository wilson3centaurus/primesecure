package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Test

class DiagnosticFormatTest {
    @Test fun androidWrapperExposesRootCauseWithoutPrivateMessages() {
        val cause=IllegalStateException("SECRET token and student content")
        cause.stackTrace=arrayOf(StackTraceElement("AgentBoot","schedule","private-file.txt",42))
        val wrapper=RuntimeException("Unable to receive intent PRIVATE",cause)
        assertSame(cause,DiagnosticFormat.rootCause(wrapper))
        assertEquals(listOf("AgentBoot.schedule:42"),DiagnosticFormat.frames(DiagnosticFormat.rootCause(wrapper).stackTrace))
    }
    @Test fun cyclicCauseChainTerminates() {
        val a=RuntimeException();val b=RuntimeException();a.initCause(b);b.initCause(a)
        assertSame(b,DiagnosticFormat.rootCause(a))
    }
    @Test fun deepCauseChainIsBounded() {
        var error:Throwable=IllegalStateException()
        repeat(100) { error=RuntimeException(error) }
        assertNotNull(DiagnosticFormat.rootCause(error))
    }
    @Test fun exceptionMessagesNeverEnterStackFrames() {
        val error=IllegalStateException("password=SECRET token=JWT student-message=PRIVATE")
        val text=DiagnosticFormat.frames(error.stackTrace).joinToString()
        assertFalse(text.contains("SECRET"));assertFalse(text.contains("PRIVATE"));assertFalse(text.contains("JWT"))
    }
    @Test fun framesAreBounded() {
        val frames=Array(100) { StackTraceElement("Class".repeat(80),"method","secret-file.txt",123) }
        val result=DiagnosticFormat.frames(frames)
        assertEquals(16,result.size);assertTrue(result.all { it.length<=200 && !it.contains("secret-file") })
    }
    @Test fun eventCodesAreBoundedAndMachineReadable() {
        val code=DiagnosticFormat.safeCode("A ".repeat(200))
        assertTrue(code.matches(Regex("[a-z0-9_.:-]{1,80}")))
        assertEquals("unknown",DiagnosticFormat.safeCode(""))
    }
    @Test fun informationFloodDoesNotEvictAFatalEvent() {
        val retained=mutableListOf("fatal")
        repeat(500) { retained+="info";if(retained.size>200)retained.removeAt(DiagnosticFormat.dropIndex(retained)) }
        assertEquals(200,retained.size);assertEquals("fatal",retained.first())
    }
}
