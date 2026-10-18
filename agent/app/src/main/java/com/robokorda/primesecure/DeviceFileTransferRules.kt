package com.robokorda.primesecure

/** Shared with JVM tests: no Android dependency and no path normalization surprises. */
internal object DeviceFileTransferRules {
    const val MAX_BYTES=500_000_000L
    fun validPath(path:String):Boolean {
        if(path.isBlank() || path.length>1000 || path.startsWith('/') || path.endsWith('/') || path.any { it=='\\' || it==':' || it.code<32 || it.code==127 })return false
        val parts=path.split('/')
        if(parts.any { it.isEmpty() || it.startsWith('.') })return false
        val relative=if(parts.first()=="@usb") {
            if(parts.size<3 || !parts[1].matches(Regex("[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}")))return false
            parts.drop(2)
        } else {
            if(path.startsWith('@'))return false
            parts
        }
        return !relative.first().equals("Android",true)
    }
    fun validateMetadata(expectedSize:Long,expectedModified:Long,size:Long,modified:Long) {
        require(expectedSize in 0..MAX_BYTES && expectedModified>=0) { "Original must be at most 500 MB" }
        require(size==expectedSize && modified==expectedModified) { "File changed since the inventory. Refresh it before requesting again." }
    }
}
