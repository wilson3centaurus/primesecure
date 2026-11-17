package com.robokorda.primesecure

import android.app.Activity
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Shared visual language for every PrimeBook first-boot page. */
object FirstBootUi {
    val navy = Color.rgb(9, 24, 78)
    val blue = Color.rgb(55, 55, 211)
    val muted = Color.rgb(91, 101, 130)
    val green = Color.rgb(23, 155, 72)
    val line = Color.rgb(211, 218, 237)

    fun screen(activity: Activity, content: View, scroll: Boolean = false): View {
        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(activity, 34), dp(activity, 20), dp(activity, 34), dp(activity, 16))
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.rgb(246, 249, 255), Color.WHITE, Color.rgb(239, 243, 255)),
            )
        }
        root.addView(header(activity), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(activity, 64)))
        val contentWidth = content.layoutParams?.width?.takeIf { it > 0 } ?: ViewGroup.LayoutParams.MATCH_PARENT
        val centeredHost = FrameLayout(activity).apply {
            addView(content, FrameLayout.LayoutParams(contentWidth, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        }
        val holder = if (scroll) ScrollView(activity).apply {
            isFillViewport = true
            addView(centeredHost, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        } else centeredHost
        root.addView(holder, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(footerLine(activity), LinearLayout.LayoutParams(dp(activity, 560), dp(activity, 2)).apply {
            gravity = Gravity.CENTER_HORIZONTAL; topMargin = dp(activity, 12); bottomMargin = dp(activity, 4)
        })
        return root
    }

    fun header(activity: Activity): View = LinearLayout(activity).apply {
        gravity = Gravity.CENTER_VERTICAL
        addView(ImageView(activity).apply {
            setImageResource(R.drawable.primebook_transparent); contentDescription = "PrimeOS"; scaleType = ImageView.ScaleType.FIT_CENTER
        }, LinearLayout.LayoutParams(dp(activity, 52), dp(activity, 52)))
        addView(LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            addView(text(activity, "PrimeOS", 22f, navy, true))
            addView(text(activity, "powered by RoboKorda Africa", 11f, muted))
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { leftMargin = dp(activity, 10) })
        if (BuildConfig.FIRST_BOOT_TEST_MODE) addView(text(activity, "TEST BUILD", 11f, Color.rgb(165, 76, 0), true).apply {
            gravity = Gravity.CENTER; setPadding(dp(activity, 12), dp(activity, 7), dp(activity, 12), dp(activity, 7))
            background = rounded(activity, Color.rgb(255, 239, 214), 18, Color.rgb(235, 174, 92))
        })
    }

    fun footerLine(activity: Activity): View = View(activity).apply {
        background = GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            intArrayOf(Color.TRANSPARENT, Color.rgb(90, 90, 225), Color.TRANSPARENT),
        )
    }

    fun centered(activity: Activity, maxWidth: Int = 760): LinearLayout = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
        setPadding(dp(activity, 12), dp(activity, 12), dp(activity, 12), dp(activity, 12))
        layoutParams = LinearLayout.LayoutParams(minOf(dp(activity, maxWidth), activity.resources.displayMetrics.widthPixels - dp(activity, 68)), ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.CENTER
        }
    }

    fun card(activity: Activity, radius: Int = 22): LinearLayout = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(activity, 28), dp(activity, 22), dp(activity, 28), dp(activity, 24))
        background = rounded(activity, Color.argb(244, 255, 255, 255), radius, line)
    }

    fun title(activity: Activity, value: String, size: Float = 30f) = text(activity, value, size, navy, true).apply { gravity = Gravity.CENTER }
    fun subtitle(activity: Activity, value: String, size: Float = 16f) = text(activity, value, size, muted).apply { gravity = Gravity.CENTER }

    fun button(activity: Activity, label: String, secondary: Boolean = false, click: () -> Unit) = Button(activity).apply {
        text = label; isAllCaps = false; textSize = 15f; stateListAnimator = null
        setTextColor(if (secondary) navy else Color.WHITE)
        backgroundTintList = ColorStateList.valueOf(if (secondary) Color.WHITE else blue)
        background = rounded(activity, if (secondary) Color.WHITE else blue, 13, if (secondary) Color.rgb(174, 184, 210) else null)
        setOnClickListener { click() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(activity, 52)).apply { topMargin = dp(activity, 10) }
    }

    fun icon(activity: Activity, resource: Int, size: Int, description: String? = null) = ImageView(activity).apply {
        setImageResource(resource)
        contentDescription = description
        scaleType = ImageView.ScaleType.FIT_CENTER
        layoutParams = LinearLayout.LayoutParams(dp(activity, size), dp(activity, size)).apply {
            gravity = Gravity.CENTER_HORIZONTAL
        }
    }

    fun text(activity: Activity, value: String, size: Float, color: Int, bold: Boolean = false) = TextView(activity).apply {
        text = value; textSize = size; setTextColor(color)
        typeface = Typeface.create(if (bold) "sans-serif-medium" else "sans-serif", Typeface.NORMAL)
        setLineSpacing(dp(activity, 2).toFloat(), 1f)
    }

    fun space(activity: Activity, size: Int) = View(activity).apply { layoutParams = LinearLayout.LayoutParams(1, dp(activity, size)) }

    fun rounded(activity: Activity, fill: Int, radius: Int, stroke: Int? = null) = GradientDrawable().apply {
        cornerRadius = dp(activity, radius).toFloat(); setColor(fill); if (stroke != null) setStroke(dp(activity, 1), stroke)
    }

    fun dp(activity: Activity, value: Int) = (activity.resources.displayMetrics.density * value).toInt()
}
