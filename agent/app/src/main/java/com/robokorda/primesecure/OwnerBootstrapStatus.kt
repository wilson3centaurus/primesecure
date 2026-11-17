package com.robokorda.primesecure

import android.content.Context
import android.provider.Settings

/** Read-only status written by the firmware-owned UID-shell bootstrap. */
object OwnerBootstrapStatus {
    const val SETTINGS_KEY = "robokorda_owner_bootstrap_status"

    fun read(context: Context): String = runCatching {
        Settings.Global.getString(context.contentResolver, SETTINGS_KEY)
    }.getOrNull()?.trim()?.takeIf { it.isNotEmpty() } ?: "not reported"
}
