package com.robokorda.primesecure

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build

object Notifications {
    const val SERVICE_ID = 1
    private const val SERVICE_CHANNEL = "service"
    private const val MESSAGE_CHANNEL = "messages"

    private fun manager(context: Context) =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        manager(context).createNotificationChannels(listOf(
            NotificationChannel(SERVICE_CHANNEL, "Device management", NotificationManager.IMPORTANCE_MIN).apply {
                setShowBadge(false)
            },
            NotificationChannel(MESSAGE_CHANNEL, "Messages from school", NotificationManager.IMPORTANCE_HIGH),
        ))
    }

    private fun builder(context: Context, channel: String): Notification.Builder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, channel)
        else @Suppress("DEPRECATION") Notification.Builder(context)

    fun service(context: Context): Notification {
        createChannels(context)
        val open = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        return builder(context, SERVICE_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentTitle("PrimeSecure")
            .setContentText("This Primebook is managed by your school")
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    /** Heads-up notification that also opens the message full screen. */
    fun message(context: Context, commandId: String, title: String, body: String, from: String?) {
        createChannels(context)
        val intent = MessageActivity.intent(context, commandId, title, body, from)
        val pending = PendingIntent.getActivity(
            context, commandId.hashCode(), intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = builder(context, MESSAGE_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setContentIntent(pending)
            .setFullScreenIntent(pending, true)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .build()
        manager(context).notify(commandId.hashCode(), notification)
    }

    fun cancelMessage(context: Context, commandId: String) {
        manager(context).cancel(commandId.hashCode())
    }
}
