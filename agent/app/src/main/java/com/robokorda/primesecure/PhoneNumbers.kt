package com.robokorda.primesecure

internal object PhoneNumbers {
    fun zimbabwe(value:String):String? {
        val compact=value.trim().replace(Regex("[\\s()-]"),"")
        val normalized=when {
            compact.startsWith("+263") -> compact
            compact.startsWith("263") -> "+$compact"
            compact.startsWith("0") -> "+263${compact.drop(1)}"
            else -> compact.takeIf { it.startsWith("+") }
        } ?: return null
        return normalized.takeIf { it.matches(Regex("^\\+[1-9][0-9]{7,14}$")) }
    }
}
