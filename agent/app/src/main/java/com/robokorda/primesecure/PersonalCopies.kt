package com.robokorda.primesecure

import android.os.Environment
import java.io.File

internal object PersonalCopies {
    @Synchronized fun copy(source:File,title:String):File {
        check(FileManager.hasAccess()) { "Ask your technician to enable media access first." }
        check(source.isFile&&!java.nio.file.Files.isSymbolicLink(source.toPath())) { "File is unavailable." }
        val root=Environment.getExternalStorageDirectory().canonicalFile
        val folder=File(root,"Documents/PrimeSecure Copies").canonicalFile
        check(folder.path.startsWith(root.path+File.separator)) { "Copy destination is unavailable." }
        check(folder.isDirectory||folder.mkdirs()) { "Could not create the copies folder." }
        val base=title.replace(Regex("[^\\p{L}\\p{N} _.-]"),"_").trim().trim('.').take(100).ifBlank { "School resource" }
        val extension=source.extension.take(12).filter { it.isLetterOrDigit() }
        val suffix=if(extension.isBlank()) "" else ".$extension"
        var target=File(folder,base+suffix);var number=1
        while(target.exists()) { target=File(folder,"$base (${number++})$suffix");check(number<10000) { "Too many copies with this name." } }
        check(target.canonicalFile.parentFile==folder) { "Invalid copy destination." }
        val bytes=source.length();val modified=source.lastModified()
        try {
            source.inputStream().use { input -> target.outputStream().use { output -> input.copyTo(output) } }
            check(target.length()==bytes&&source.length()==bytes&&source.lastModified()==modified) { "The file changed while copying. Retry." }
            return target
        } catch(error:Exception) { target.delete();throw error }
    }
}
