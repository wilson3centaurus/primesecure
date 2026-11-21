package com.robokorda.primesecure

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Read-only factory content carried by the AVB-protected OS image. */
internal object FactoryPreload {
    private val roots = listOf(
        File("/product/etc/primesecure-preload"),
        File("/system/etc/primesecure-preload"),
    )

    private fun root(): File? = roots.firstOrNull { File(it, "manifest.json").isFile }

    private fun manifest(): JSONObject? = root()?.let { base ->
        runCatching { JSONObject(File(base, "manifest.json").readText()) }.getOrNull()
    }

    fun file(item: JSONObject): File? {
        val relative = item.stringOrNull("factory_path") ?: return null
        if (relative.startsWith('/') || relative.startsWith('\\')) return null
        val base = root()?.canonicalFile ?: return null
        val target = File(base, relative).canonicalFile
        val prefix = base.path.trimEnd(File.separatorChar) + File.separator
        return target.takeIf { it.path.startsWith(prefix) && it.isFile }
    }

    fun merge(server: JSONObject): JSONObject {
        val manifest = manifest() ?: return server
        val preload = manifest.optJSONArray("items") ?: return server
        val local = (0 until preload.length()).mapNotNull { index ->
            preload.optJSONObject(index)?.let { JSONObject(it.toString()) }
        }.filter { file(it) != null }
        if (local.isEmpty()) return server

        val localAppPackages = local.filter { it.optString("kind") == "app" }
            .map { it.optString("package_name") }.filter { it.isNotBlank() }.toSet()
        val localHashes = local.map { it.optString("sha256").lowercase() }
            .filter { it.matches(Regex("[0-9a-f]{64}")) }.toSet()
        val hasExplore = local.any(::isExplore)
        val merged = JSONArray()
        local.forEach { item ->
            // Factory apps install once without becoming non-removable school
            // requirements. A manifest may still explicitly set preinstall=true
            // when the school genuinely requires an app.
            if (item.optString("kind") == "app") item.put("factory_autoinstall", true)
            merged.put(item)
        }
        val remote = server.optJSONArray("items") ?: JSONArray()
        for (index in 0 until remote.length()) {
            val item = remote.optJSONObject(index) ?: continue
            val duplicateApp = item.optString("kind") == "app" && item.optString("package_name") in localAppPackages
            val duplicateHash = item.optString("sha256").lowercase() in localHashes
            if (!duplicateApp && !duplicateHash && !(hasExplore && isExplore(item))) merged.put(item)
        }
        return JSONObject(server.toString())
            .put("items", merged)
            .put("factory_preload_revision", manifest.optString("revision", "unknown"))
            .put("factory_preload_items", local.size)
    }

    private fun isExplore(item: JSONObject): Boolean {
        val label = listOf(item.optString("form_level"), item.optString("category"), item.optString("subject"))
            .joinToString(" ").lowercase().replace('&', ' ')
        return Regex("explore\\s+(?:and\\s+)?grow").containsMatchIn(label)
    }
}
