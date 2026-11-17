package com.robokorda.primesecure

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.WallpaperManager
import android.content.Context
import android.content.Intent
import java.io.File

/** Visible fallback while Device Owner/HOME is unresolved; not presented as lockdown. */
internal object OfflineSetupNotice {
    private const val CHANNEL = "primebook_setup_required"
    private const val ID = 8108
    private const val WALLPAPER = "/system/media/robokorda/default-wallpaper.png"

    fun refresh(context: Context) {
        val notifications = context.getSystemService(NotificationManager::class.java)
        if (AdminReceiver.isDeviceOwner(context) && SetupGatePolicy.setupComplete(context)) {
            notifications.cancel(ID)
            return
        }
        notifications.createNotificationChannel(NotificationChannel(
            CHANNEL,
            "PrimeBook setup required",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Keeps unfinished school setup visible until management is active"
            setShowBadge(true)
        })
        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val wifi = PendingIntent.getActivity(
            context,
            1,
            Intent(android.provider.Settings.ACTION_WIFI_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        notifications.notify(ID, Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.robokorda)
            .setContentTitle("PrimeBook setup is required")
            .setContentText("Connect to the internet, then open PrimeSecure to finish mandatory school setup.")
            .setStyle(Notification.BigTextStyle().bigText(
                "Connect this PrimeBook to Wi-Fi, then open PrimeSecure. School management and enrollment are not active yet."
            ))
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "Wi-Fi", wifi).build())
            .addAction(Notification.Action.Builder(null, "Open PrimeSecure", open).build())
            .build())
        applyWallpaperOnce(context)
    }

    private fun applyWallpaperOnce(context: Context) {
        val prefs = context.getSharedPreferences("v8-diagnostic-fallback", Context.MODE_PRIVATE)
        if (prefs.getInt("wallpaper_version", -1) == BuildConfig.VERSION_CODE) return
        val file = File(WALLPAPER)
        if (!file.isFile) return
        runCatching {
            file.inputStream().use { WallpaperManager.getInstance(context).setStream(it, null, true, WallpaperManager.FLAG_SYSTEM) }
            prefs.edit().putInt("wallpaper_version", BuildConfig.VERSION_CODE).commit()
        }.onFailure { DeviceLog.event(context, "warning", "setup", "fallback_wallpaper_failed", it) }
    }
}
