package com.robokorda.primesecure

import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView

/** Cosmetic preferences only. No student data or web storage is persisted here. */
object StudentTheme {
    fun preference(context: Context): String = context.getSharedPreferences("student-ui-preferences",Context.MODE_PRIVATE)
        .getString("theme","system").takeIf { it in setOf("light","dark","system") } ?: "system"

    fun save(context: Context, value: String) {
        require(value in setOf("light","dark","system")) { "Choose light, dark or system theme." }
        context.getSharedPreferences("student-ui-preferences",Context.MODE_PRIVATE).edit().putString("theme",value).apply()
    }

    fun dark(context: Context): Boolean = when(preference(context)) {
        "dark" -> true
        "light" -> false
        else -> context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
    }
    fun background(context: Context) = Color.parseColor(if(dark(context)) "#0e1423" else "#f5f7fb")
    fun surface(context: Context) = Color.parseColor(if(dark(context)) "#172033" else "#ffffff")
    fun foreground(context: Context) = Color.parseColor(if(dark(context)) "#e8edf7" else "#1e293b")

    fun html(context: Context, source: String): String {
        val value=preference(context)
        return source.replace("data-theme=\"system\"","data-theme=\"$value\"")
            .replace("<meta name=\"primesecure-theme\" content=\"system\">","<meta name=\"primesecure-theme\" content=\"$value\">")
    }

    @Suppress("DEPRECATION")
    fun applyWindow(activity: Activity) {
        val dark=dark(activity)
        activity.window.statusBarColor=surface(activity)
        activity.window.navigationBarColor=surface(activity)
        activity.window.decorView.systemUiVisibility=if(dark) 0 else View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
    }

    fun styleReader(activity: Activity, root: ViewGroup) {
        applyWindow(activity);root.setBackgroundColor(background(activity))
        val density=activity.resources.displayMetrics.density
        fun visit(view: View) {
            if(view.tag=="preserve-tone")return
            if(view is TextView) {
                view.setTextColor(foreground(activity));view.typeface=android.graphics.Typeface.create("sans-serif",android.graphics.Typeface.NORMAL)
                if(view is android.widget.EditText)view.setHintTextColor(Color.parseColor(if(dark(activity)) "#9daac3" else "#64748b"))
                if(view is Button) {
                    view.isAllCaps=false;view.textSize=12f
                    view.minHeight=(40*density).toInt();view.minWidth=(44*density).toInt()
                    view.setPadding((12*density).toInt(),(4*density).toInt(),(12*density).toInt(),(4*density).toInt())
                    view.backgroundTintList=android.content.res.ColorStateList(arrayOf(intArrayOf(android.R.attr.state_enabled),intArrayOf()),intArrayOf(Color.parseColor(if(dark(activity)) "#303052" else "#ebe8fb"),surface(activity)))
                }
            }
            if(view is ViewGroup)for(i in 0 until view.childCount)visit(view.getChildAt(i))
        }
        visit(root)
    }
}
