package com.robokorda.primesecure

import android.app.Activity
import android.app.Application
import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.*
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.*

/** Small durable outbox in device-protected storage, available before first unlock. */
internal object DeviceLog {
    private val lock = Any()
    private val installed = AtomicBoolean()
    private val scope = CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private fun prefs(c: Context) = c.createDeviceProtectedStorageContext().getSharedPreferences("diagnostic-outbox",Context.MODE_PRIVATE)
    fun bind(c: Context, device: String?) = synchronized(lock) {
        val p=prefs(c); val old=p.getString("device",null)
        if(old!=null && old!=device) p.edit().clear().commit()
        p.edit().putString("device",device).commit(); Unit
    }
    fun event(c:Context, severity:String, category:String, code:String, error:Throwable?=null, details:JSONObject=JSONObject()) {
        scope.launch { record(c.applicationContext,severity,category,code,error,details); schedule(c) }
    }
    fun record(c:Context,severity:String,category:String,code:String,error:Throwable?=null,details:JSONObject=JSONObject()) = runCatching { synchronized(lock) {
        val p=prefs(c);val events=JSONArray(p.getString("events","[]"));val now=System.currentTimeMillis()
        val safe=JSONObject()
        for(k in listOf("phase","strict","hidden","suspended","package","elapsed_ms","boot_count","user_unlocked","reason")) if(details.has(k)) {
            val value=details.get(k)
            if(value is Boolean || value is Number) safe.put(k,value)
            else if(value is String && value.matches(Regex("[A-Za-z0-9_.:$-]{1,160}"))) safe.put(k,value)
        }
        error?.let { DiagnosticFormat.rootCause(it) }?.let {
            safe.put("exception",it.javaClass.name.take(160)).put("frames",JSONArray(DiagnosticFormat.frames(it.stackTrace)))
        }
        val fingerprint="$severity:$category:${DiagnosticFormat.safeCode(code)}:$safe"
        if(p.getString("last_key",null)==fingerprint && now-p.getLong("last_at",0) in 0..59_999) return@synchronized
        val e=JSONObject().put("id",UUID.randomUUID().toString()).put("occurred_at",Instant.ofEpochMilli(now).toString())
            .put("severity",severity).put("category",category).put("code",DiagnosticFormat.safeCode(code))
            .put("version",BuildConfig.VERSION_NAME).put("details",safe)
        events.put(e)
        val retained=(0 until events.length()).map { events.getJSONObject(it) }.toMutableList()
        while(retained.size>200)retained.removeAt(DiagnosticFormat.dropIndex(retained.map { it.optString("severity") }))
        val bounded=JSONArray(retained)
        p.edit().putString("events",bounded.toString()).putString("last_key",fingerprint).putLong("last_at",now).commit()
    } }.let { Unit }
    fun state(c:Context,key:String,category:String,code:String,details:JSONObject) = runCatching {
        val p=prefs(c);val value=details.toString()
        if(p.getString("state:$key",null)!=value) {
            p.edit().putString("state:$key",value).commit()
            event(c,"info",category,code,details=details)
        }
    }.let { Unit }
    fun batch(c:Context,device:String?,limit:Int=30):JSONArray = synchronized(lock) {
        val p=prefs(c)
        if(p.getString("device",null)!=device) return@synchronized JSONArray()
        val all=JSONArray(p.getString("events","[]"))
        JSONArray((0 until minOf(limit,all.length())).map { all.getJSONObject(it) })
    }
    fun acknowledge(c:Context,ids:Set<String>) = synchronized(lock) {
        val p=prefs(c);val all=JSONArray(p.getString("events","[]"))
        p.edit().putString("events",JSONArray((0 until all.length()).map { all.getJSONObject(it) }.filter { it.optString("id") !in ids }).toString()).commit(); Unit
    }
    private fun schedule(c:Context) = runCatching {
        if(c.getSystemService(UserManager::class.java).isUserUnlocked && AgentStore(c).isEnrolled) DiagnosticsWorker.schedule(c)
    }
    fun install(app:Application) {
        if(!installed.compareAndSet(false,true))return
        val old=Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread,error ->
            try { record(app,"fatal","crash","uncaught_exception",error) } catch(_:Throwable) { }
            finally { if(old!=null)old.uncaughtException(thread,error) else { android.os.Process.killProcess(android.os.Process.myPid());kotlin.system.exitProcess(10) } }
        }
        val resumed=AtomicInteger()
        app.registerActivityLifecycleCallbacks(object:Application.ActivityLifecycleCallbacks {
            override fun onActivityResumed(a:Activity) { resumed.incrementAndGet() }
            override fun onActivityPaused(a:Activity) { resumed.updateAndGet { maxOf(0,it-1) } }
            override fun onActivityCreated(a:Activity,b:Bundle?) {} override fun onActivityStarted(a:Activity) {}
            override fun onActivityStopped(a:Activity) {} override fun onActivitySaveInstanceState(a:Activity,b:Bundle) {}
            override fun onActivityDestroyed(a:Activity) {}
        })
        val main=Handler(Looper.getMainLooper())
        val posted=AtomicBoolean()
        scope.launch {
            val heartbeat=AtomicLong(SystemClock.elapsedRealtime());var stalled=false
            while(isActive) {
                val delay=SystemClock.elapsedRealtime()-heartbeat.get()
                if(resumed.get()>0 && delay>12_000 && !stalled) {
                    stalled=true
                    record(app,"error","anr","main_thread_stall",details=JSONObject().put("elapsed_ms",delay))
                    record(app,"error","anr","main_thread_frames",Throwable().apply { stackTrace=Looper.getMainLooper().thread.stackTrace })
                    schedule(app)
                }
                if(delay<4000 && stalled) { stalled=false;event(app,"info","anr","main_thread_recovered") }
                if(posted.compareAndSet(false,true)) main.post { heartbeat.set(SystemClock.elapsedRealtime());posted.set(false) }
                kotlinx.coroutines.delay(2000)
            }
        }
        event(app,"info","boot","process_started",details=JSONObject().put("user_unlocked",app.getSystemService(UserManager::class.java).isUserUnlocked))
        if(Build.VERSION.SDK_INT>=30) scope.launch { runCatching {
            val p=prefs(app);val last=p.getLong("last_exit",0)
            val exits=app.getSystemService(ActivityManager::class.java).getHistoricalProcessExitReasons(app.packageName,0,5)
            for(exit in exits.filter { it.timestamp>last && it.reason in setOf(ApplicationExitInfo.REASON_ANR,ApplicationExitInfo.REASON_CRASH,ApplicationExitInfo.REASON_CRASH_NATIVE) }) {
                record(app,"error",if(exit.reason==ApplicationExitInfo.REASON_ANR)"anr" else "crash","previous_process_exit",details=JSONObject().put("reason",exit.reason))
            }
            exits.maxOfOrNull { it.timestamp }?.let { p.edit().putLong("last_exit",it).commit() }
            schedule(app)
        } }
    }
}
