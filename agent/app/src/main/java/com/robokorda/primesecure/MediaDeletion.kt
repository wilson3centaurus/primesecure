package com.robokorda.primesecure

import java.io.File

/** One indexed personal file only: never directories, links, recursive operations or changed files. */
internal object MediaDeletion {
    data class Snapshot(val canonicalPath:String,val size:Long,val modified:Long)
    fun snapshot(file:File)=Snapshot(file.canonicalPath,file.length(),file.lastModified())
    fun delete(file:File,expected:Snapshot) {
        check(file.isFile && !java.nio.file.Files.isSymbolicLink(file.toPath())) { "This file is no longer available. Refresh Media." }
        check(file.canonicalPath==expected.canonicalPath && file.absolutePath==expected.canonicalPath && file.length()==expected.size && file.lastModified()==expected.modified) { "This file has changed. Refresh Media before deleting it." }
        check(file.delete()) { "Could not delete this file. Check file access and try again." }
    }
}
