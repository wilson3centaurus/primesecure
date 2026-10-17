package com.robokorda.primesecure

import java.io.File
import java.util.ArrayDeque

/** Local-only discovery, independent of the smaller server inventory. Never follows links. */
internal object MediaDiscovery {
    private val extensions = setOf("jpg","jpeg","png","webp","gif","bmp","heic","heif","mp4","webm","mkv","avi","mov","m4v","3gp","mp3","ogg","opus","m4a","aac","wav","flac","pdf","doc","docx","odt","rtf","txt","epub","xls","xlsx","ppt","pptx")
    data class Result(val files: List<Pair<String,File>>, val truncated:Boolean, val inaccessible:Int)
    fun scan(roots: Map<File,String>, limit:Int=20_000, maxVisited:Int=200_000, budgetMs:Long=20_000):Result {
        val found=mutableListOf<Pair<String,File>>()
        val queue=ArrayDeque<Triple<File,File,String>>()
        roots.forEach { (root,prefix)-> val base=root.canonicalFile;queue.add(Triple(base,base,prefix)) }
        val deadline=System.nanoTime()+budgetMs*1_000_000
        var visited=0;var inaccessible=0;var truncated=false
        scan@ while(queue.isNotEmpty()) {
            val (dir,base,prefix)=queue.removeFirst()
            val children=dir.listFiles()
            if(children==null) { inaccessible++;continue }
            for(file in children) {
                if(++visited>maxVisited || found.size>=limit || System.nanoTime()>deadline) { truncated=true;break@scan }
                if(file.name.startsWith('.'))continue
                val canonical=runCatching { file.canonicalFile }.getOrNull() ?: continue
                if(canonical!=file.absoluteFile || !canonical.path.startsWith(base.path+File.separator))continue
                val relative=canonical.toRelativeString(base).replace(File.separatorChar,'/')
                if(relative=="Android/data" || relative=="Android/obb")continue
                if(file.isDirectory)queue.add(Triple(canonical,base,prefix))
                else if(file.isFile && file.extension.lowercase() in extensions)found.add(listOf(prefix,relative).filter { it.isNotEmpty() }.joinToString("/") to file)
            }
        }
        return Result(found.sortedByDescending { it.second.lastModified() },truncated,inaccessible)
    }
}
