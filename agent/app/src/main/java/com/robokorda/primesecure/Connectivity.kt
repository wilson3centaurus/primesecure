package com.robokorda.primesecure

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.io.IOException

object Connectivity {
    fun online(context: Context): Boolean {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        return cm.getNetworkCapabilities(cm.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
    }
    fun message(error: Throwable): String = when {
        generateSequence(error) { it.cause }.any { it is java.net.UnknownHostException || it is java.net.SocketException || it is java.net.SocketTimeoutException || it is javax.net.ssl.SSLException || (it is IOException && it.message?.contains("connection",true)==true) } ->
            "No internet connection, or the school server is unreachable. Your saved content is available offline; pending tasks will retry automatically."
        else -> error.message?.take(300) ?: "This action could not be completed. Please try again."
    }
}
