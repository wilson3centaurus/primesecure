package com.robokorda.primesecure

import android.os.Build
import android.os.Environment
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * push_file / delete_file / list_files on shared storage (/sdcard). Needs
 * all-files access, an app-op the Device Owner can't grant itself; provisioning
 * sets it over adb (see README).
 */
class FileManager(private val store: AgentStore, private val context: android.content.Context? = null) {

    @Suppress("DEPRECATION")
    private val root: File = Environment.getExternalStorageDirectory()

    fun list(payload: JSONObject): JSONObject {
        val dir = resolve(payload.optString("path", ""))
        if (!dir.isDirectory) throw IllegalArgumentException("not a folder")
        val children = dir.listFiles()?.toList().orEmpty()
            .sortedWith(compareBy<File>({ !it.isDirectory }, { it.name.lowercase() }))
        val entries = JSONArray()
        children.take(MAX_ENTRIES).forEach { f ->
            entries.put(JSONObject()
                .put("name", f.name)
                .put("dir", f.isDirectory)
                .put("size", if (f.isFile) f.length() else JSONObject.NULL)
                .put("modified", f.lastModified()))
        }
        if(dir==root.canonicalFile && !usbBlocked()) usbRoots().forEach { volume ->
            entries.put(JSONObject().put("name","USB / removable drive ${volume.name}").put("path","@usb/${volume.name}").put("dir",true).put("size",JSONObject.NULL).put("modified",volume.lastModified()))
        }
        return JSONObject()
            .put("path", relative(dir))
            .put("entries", entries)
            .put("truncated", children.size > MAX_ENTRIES)
            .put("free_bytes", root.usableSpace)
    }

    suspend fun push(payload: JSONObject): JSONObject {
        val storagePath = payload.stringOrNull("storage_path") ?: throw IllegalArgumentException("no storage_path")
        val target = resolve(payload.stringOrNull("path") ?: throw IllegalArgumentException("no destination path"))
        if (target == root.canonicalFile || target in usbRoots()) throw IllegalArgumentException("destination must be a file")
        target.parentFile?.mkdirs()
        val part = File(target.parentFile, ".${target.name}.part")
        try {
            SupabaseApi(store).download("/storage/v1/object/media/$storagePath", part)
            if (target.exists() && !target.delete()) error("could not replace existing file")
            if (!part.renameTo(target)) error("could not save file")
        } finally {
            part.delete()
        }
        return JSONObject().put("path", relative(target)).put("size", target.length())
    }

    fun delete(payload: JSONObject): JSONObject {
        val target = resolve(payload.stringOrNull("path") ?: throw IllegalArgumentException("no path"))
        if (target == root.canonicalFile || target in usbRoots()) throw IllegalArgumentException("refusing to delete a storage root")
        if (!target.exists()) return JSONObject().put("path", relative(target)).put("note", "already gone")
        val ok = if (target.isDirectory) {
            if (!payload.optBoolean("recursive", false) && !target.list().isNullOrEmpty()) {
                throw IllegalArgumentException("folder is not empty")
            }
            target.deleteRecursively()
        } else {
            target.delete()
        }
        if (!ok) error("could not delete")
        return JSONObject().put("path", relative(target))
    }

    /** Maps a dashboard path (relative to /sdcard) to a file, refusing anything outside it. */
    private fun resolve(path: String): File {
        requireAccess()
        if(path.startsWith("@usb/")) {
            if(usbBlocked())error("Your school has blocked removable storage")
            val parts=path.removePrefix("@usb/").split('/',limit=2)
            val volume=usbRoots().find { it.name==parts[0] } ?: error("Removable drive unavailable")
            val file=File(volume,parts.getOrElse(1){""}).canonicalFile
            if(file!=volume && !file.path.startsWith(volume.path+File.separator))error("Path is outside the removable drive")
            return file
        }
        val base = root.canonicalFile
        val file = File(base, path.trim().trimStart('/')).canonicalFile
        if (file != base && !file.path.startsWith(base.path + File.separator)) {
            throw IllegalArgumentException("path is outside shared storage")
        }
        return file
    }

    private fun relative(file: File):String {
        val canonical=file.canonicalFile
        usbRoots().find { canonical==it || canonical.path.startsWith(it.path+File.separator) }?.let {
            val path=canonical.toRelativeString(it)
            return "@usb/${it.name}"+if(path.isBlank())"" else "/$path"
        }
        return canonical.toRelativeString(root.canonicalFile)
    }
    private fun usbRoots()=File("/storage").listFiles()?.filter { it.isDirectory && it.name.matches(Regex("[0-9a-fA-F]{4}-[0-9a-fA-F]{4}")) }?.map { it.canonicalFile }.orEmpty()
    private fun usbBlocked()=context?.let { HubStore(it).catalog.optJSONObject("management")?.optBoolean("block_usb_storage") }==true
    fun checkedFile(path: String): File = resolve(path).also { require(it.isFile) { "File unavailable" } }

    private fun requireAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && !Environment.isExternalStorageManager()) {
            error("all-files access not granted: adb shell appops set com.robokorda.primesecure MANAGE_EXTERNAL_STORAGE allow")
        }
    }

    companion object {
        private const val MAX_ENTRIES = 500

        fun hasAccess(): Boolean =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.R || Environment.isExternalStorageManager()
    }
}
