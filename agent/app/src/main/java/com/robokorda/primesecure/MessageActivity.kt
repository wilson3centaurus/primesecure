package com.robokorda.primesecure

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import android.widget.*
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import org.json.JSONObject

class MessageActivity : Activity() {
    private val scope = MainScope()
    private var required = false
    private var messageId = ""
    private var watch:Job?=null
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setFinishOnTouchOutside(false)
        if (android.os.Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        render(intent)
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); render(intent); enforce() }
    override fun onResume() { super.onResume(); enforce();watch=scope.launch {
        while(true) {
            delay(2000)
            val removed=withContext(Dispatchers.IO) { messageId.isNotBlank() && HubStore(this@MessageActivity).message(messageId)==null }
            if(removed) { required=false;if(AgentStore(this@MessageActivity).lastStatus!="locked")runCatching { stopLockTask() };finish();showPending(this@MessageActivity);break }
        }
    } }
    override fun onPause() { watch?.cancel();watch=null;super.onPause() }
    private fun enforce() {
        if (AgentStore(this).lastStatus == "locked") { startActivity(LockActivity.intent(this)); finish(); return }
        if (required && AdminReceiver.isDeviceOwner(this)) runCatching {
            val dpm = AdminReceiver.dpm(this)
            dpm.setLockTaskPackages(AdminReceiver.component(this), arrayOf(packageName))
            if (android.os.Build.VERSION.SDK_INT >= 28) dpm.setLockTaskFeatures(AdminReceiver.component(this), DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS)
            startLockTask()
        }.onFailure { Toast.makeText(this, "This device could not enforce acknowledgement mode", Toast.LENGTH_LONG).show() }
    }
    private fun render(intent: Intent) {
        val hub = HubStore(this)
        val requested = intent.getStringExtra("id").orEmpty()
        val message = hub.pending() ?: hub.message(requested)
        messageId = message?.optString("id") ?: requested
        val payload = message?.optJSONObject("payload") ?: JSONObject()
            .put("title", intent.getStringExtra("title")).put("body", intent.getStringExtra("body"))
        required = payload.optBoolean("require_ack") && message?.optBoolean("acknowledged") != true
        Notifications.cancelMessage(this, messageId)
        hub.seen(messageId)
        MessageAckWorker.schedule(this)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(20, 16, 20, 16); setBackgroundColor(StudentTheme.background(this@MessageActivity)) }
        val header=LinearLayout(this).apply { tag="preserve-tone";orientation=LinearLayout.VERTICAL; setPadding(20,16,20,16); background=android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,intArrayOf(0xff5147bb.toInt(),0xff6b72c9.toInt())).apply { cornerRadius=20f } }
        header.addView(TextView(this).apply { text=if(required) "SCHOOL NOTICE · ACKNOWLEDGEMENT REQUIRED" else "YOUR SCHOOL INBOX"; textSize=11f; setTextColor(0xffddd9ff.toInt()); setPadding(0,0,0,14) })
        header.addView(TextView(this).apply { text = payload.optString("title", "Message from school"); textSize = 22f; setTextColor(android.graphics.Color.WHITE); setTypeface(null,android.graphics.Typeface.BOLD) })
        header.addView(TextView(this).apply { text = "${payload.optString("from")}  •  ${message?.optString("created_at").orEmpty()}"; setTextColor(0xffe4e0ff.toInt()); textSize=12f; setPadding(0, 12, 0, 0) })
        root.addView(header)
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(16,14,16,14); setBackgroundColor(StudentTheme.surface(this@MessageActivity)) }
        MessageContent.render(this, body, payload, scope)
        root.addView(ScrollView(this).apply { addView(body) }, LinearLayout.LayoutParams(-1, 0, 1f))
        val reply=EditText(this).apply { hint="Reply to school"; maxLines=3 }
        val anonymous=CheckBox(this).apply { text="Mark anonymous (school administrators still see your name)" }
        root.addView(reply); root.addView(anonymous)
        root.addView(Button(this).apply { text="Send reply"; setOnClickListener {
            val body=reply.text.toString().trim()
            if(body.isNotBlank()) scope.launch {
                runCatching { withContext(Dispatchers.IO) { HubTasks(this@MessageActivity).enqueue("reply",JSONObject().put("command_id",messageId).put("body",body).put("anonymous",anonymous.isChecked),"Reply to school") } }
                    .onSuccess { OfflineWorker.schedule(this@MessageActivity);reply.text.clear();Toast.makeText(this@MessageActivity,"Reply saved. It will send when internet is available.",Toast.LENGTH_LONG).show() }
                    .onFailure { Toast.makeText(this@MessageActivity,Connectivity.message(it),Toast.LENGTH_LONG).show() }
            }
        } })
        root.addView(Button(this).apply {
            text = if (message?.optBoolean("acknowledged") == true) "Close" else "I acknowledge"
            setOnClickListener {
                hub.acknowledge(messageId)
                MessageAckWorker.schedule(this@MessageActivity)
                if (AgentStore(this@MessageActivity).lastStatus != "locked") runCatching { stopLockTask() }
                required = false
                finish()
                showPending(this@MessageActivity)
            }
        })
        StudentTheme.styleReader(this,root);setContentView(root)
    }
    @Deprecated("Required notices must be acknowledged")
    override fun onBackPressed() { if (!required) { @Suppress("DEPRECATION") super.onBackPressed() } }
    override fun onDestroy() { scope.cancel(); super.onDestroy() }
    companion object {
        fun intent(context: Context, id: String, title: String, body: String, from: String?): Intent =
            Intent(context, MessageActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra("id", id).putExtra("title", title).putExtra("body", body).putExtra("from", from)
        fun showPending(context: Context) {
            if (AgentStore(context).lastStatus == "locked") return
            val m = HubStore(context).pending() ?: return
            val p = m.getJSONObject("payload")
            context.startActivity(intent(context, m.getString("id"), p.optString("title"), p.optString("body"), p.optString("from")))
        }
    }
}
