package com.robokorda.primesecure

/** No exception messages or arguments: they can contain URLs, credentials or student content. */
internal object DiagnosticFormat {
    /** Android wraps receiver failures; preserve the actionable cause without its message. */
    fun rootCause(error: Throwable): Throwable {
        val seen = java.util.Collections.newSetFromMap(java.util.IdentityHashMap<Throwable, Boolean>())
        var current = error
        repeat(16) {
            seen.add(current)
            val next = current.cause ?: return current
            if (next in seen) return current
            current = next
        }
        return current
    }
    fun dropIndex(severities: List<String>): Int = listOf("info", "warning", "error").firstNotNullOfOrNull { level ->
        severities.indexOf(level).takeIf { it >= 0 }
    } ?: 0
    fun frames(stack: Array<StackTraceElement>): List<String> = stack.take(16).map {
        "${it.className}.${it.methodName}:${it.lineNumber}".take(200)
    }
    fun safeCode(value: String): String = value.lowercase().replace(Regex("[^a-z0-9_.:-]"), "_").take(80).ifBlank { "unknown" }
}
