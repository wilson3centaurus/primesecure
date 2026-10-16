package com.robokorda.primesecure

import android.app.Service
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.UserManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import org.json.JSONObject
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Only the recovery capability and escrow token are available before unlock, encrypted with Android Keystore. */
object BootRecovery {
    private const val ALIAS="primesecure-boot-recovery"
    private val registration=Mutex()
    private fun prefs(context:Context)=context.createDeviceProtectedStorageContext().getSharedPreferences("boot-recovery",Context.MODE_PRIVATE)
    private fun key():SecretKey {
        val store=KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS,null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setUserAuthenticationRequired(false).build())
        }.generateKey()
    }
    fun save(context:Context,value:JSONObject) {
        val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key())
        val bytes=cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8))
        check(prefs(context).edit().putString("data",Base64.encodeToString(bytes,Base64.NO_WRAP)).putString("iv",Base64.encodeToString(cipher.iv,Base64.NO_WRAP)).commit())
    }
    fun load(context:Context):JSONObject? {
        val prefs=prefs(context);val data=prefs.getString("data",null) ?: return null
        val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,Base64.decode(prefs.getString("iv",null),Base64.NO_WRAP)))
        return JSONObject(String(cipher.doFinal(Base64.decode(data,Base64.NO_WRAP)),Charsets.UTF_8))
    }
    suspend fun register(context:Context,token:ByteArray) = registration.withLock {
        val store=AgentStore(context)
        val current=runCatching { load(context) }.getOrNull()?.takeIf { it.optString("device_id")==store.deviceId }
        val data=JSONObject().put("device_id",store.deviceId).put("server_url",store.serverUrl).put("anon_key",store.anonKey)
            .put("token",Base64.encodeToString(token,Base64.NO_WRAP))
            .put("secret",current?.optString("secret") ?: ByteArray(32).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) })
        save(context,data.put("registered",false))
        SupabaseApi(store).rpc("device_register_recovery",JSONObject().put("p_secret",data.getString("secret")))
        save(context,data.put("registered",true))
    }
    /** App-policy recovery does not require enabling password reset escrow. */
    suspend fun ensureChannel(context:Context) = registration.withLock {
        val store=AgentStore(context)
        if(!store.isEnrolled)return@withLock
        val current=runCatching {load(context)}.getOrNull()?.takeIf {it.optString("device_id")==store.deviceId}
        if(current?.optBoolean("registered")==true)return@withLock
        val data=current ?: JSONObject().put("secret",ByteArray(32).also {SecureRandom().nextBytes(it)}.joinToString("") {"%02x".format(it)})
        data.put("device_id",store.deviceId).put("server_url",store.serverUrl).put("anon_key",store.anonKey).put("registered",false)
        save(context,data)
        SupabaseApi(store).rpc("device_register_recovery",JSONObject().put("p_secret",data.getString("secret")))
        save(context,data.put("registered",true))
    }
    fun registered(context:Context)=runCatching { load(context)?.let { it.optBoolean("registered") && it.has("token") && it.optString("device_id")==AgentStore(context).deviceId }==true }.getOrDefault(false)
    fun clear(context:Context) { DeviceSafety.clear(context);prefs(context).edit().clear().commit();runCatching { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(ALIAS) } }
    fun start(context:Context) {
        if(context.getSystemService(UserManager::class.java).isUserUnlocked)return
        runCatching { context.startForegroundService(Intent(context,BootRecoveryService::class.java)) }
    }
}

class BootRecoveryReceiver:BroadcastReceiver() {
    override fun onReceive(context:Context,intent:Intent) {
        if(intent.action !in setOf(Intent.ACTION_LOCKED_BOOT_COMPLETED, Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)) return
        val pending = goAsync()
        CoroutineScope(SupervisorJob()+Dispatchers.IO).launch {
            try {
                DeviceLog.record(context,"info","boot","boot_safety_started",details=JSONObject().put("user_unlocked",context.getSystemService(UserManager::class.java).isUserUnlocked))
                // Recover visibility locally, without Wi-Fi, account tokens or first unlock.
                runCatching { AppSafety.restoreEssentialApps(context) }
                runCatching { DeviceSafety.restoreJournal(context) }
                BootRecovery.start(context)
            } finally { pending.finish() }
        }
    }
}

class BootRecoveryService:Service() {
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private var loop:Job?=null
    override fun onCreate() {
        super.onCreate()
        val manager=getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("school-recovery","School password recovery",NotificationManager.IMPORTANCE_LOW))
        val notification=Notification.Builder(this,"school-recovery").setContentTitle("PrimeSecure startup protection").setContentText("Login protection works offline; remote recovery needs a connection").setSmallIcon(android.R.drawable.ic_lock_lock).setOngoing(true).build()
        if(android.os.Build.VERSION.SDK_INT>=34)startForeground(904,notification,android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(904,notification)
    }
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
        if(loop==null)loop=scope.launch {
            // A slow DNS/TLS request must never delay local login repair.
            val repair=launch {
                while(isActive&&!getSystemService(UserManager::class.java).isUserUnlocked) {
                    runCatching {DeviceSafety.restoreJournal(this@BootRecoveryService)}
                    runCatching {AppSafety.restoreEssentialApps(this@BootRecoveryService)}
                    delay(5_000)
                }
            }
            while(isActive&&!getSystemService(UserManager::class.java).isUserUnlocked) {
                try {
                    val data=BootRecovery.load(this@BootRecoveryService)
                    if(data==null||!data.optBoolean("registered")||!AdminReceiver.isDeviceOwner(this@BootRecoveryService)) {delay(30_000);continue}
                    @Suppress("DEPRECATION")
                    val wifi=applicationContext.getSystemService(android.net.wifi.WifiManager::class.java)
                    @Suppress("DEPRECATION")
                    if(!wifi.isWifiEnabled)runCatching { wifi.isWifiEnabled=true }
                    if(Connectivity.online(this@BootRecoveryService)) {
                        val args=JSONObject().put("p_device_id",data.getString("device_id")).put("p_secret",data.getString("secret"))
                        runCatching {
                            val events=DeviceLog.batch(this@BootRecoveryService,data.getString("device_id"))
                            if(events.length()>0) {
                                val result=rpc(data,"device_recovery_events",JSONObject(args.toString()).put("p_events",events))
                                DeviceLog.acknowledge(this@BootRecoveryService,result.stringSet("accepted_ids"))
                            }
                        }
                        val response=rpc(data,"device_recovery_poll",args)
                        DeviceSafety.observe(this@BootRecoveryService,response.optJSONObject("recovery_control"))
                        val commands=response.optJSONArray("commands")
                        if(commands!=null) for(i in 0 until commands.length()) {
                            val command=commands.getJSONObject(i);val payload=command.getJSONObject("payload")
                            var failure:String?=null
                            try {
                                val password=payload.getString("password");require(password.length in 6..64)
                                check(java.time.Instant.parse(payload.getString("expires_at")).toEpochMilli()>System.currentTimeMillis()) { "Password reset expired" }
                                val token=Base64.decode(data.getString("token"),Base64.NO_WRAP)
                                check(AdminReceiver.dpm(this@BootRecoveryService).resetPasswordWithToken(AdminReceiver.component(this@BootRecoveryService),password,token,0)) { "Android rejected password recovery" }
                            } catch(e:Exception) { failure=e.message?.take(300) ?: "Recovery failed" }
                            rpc(data,"device_recovery_ack",JSONObject(args.toString()).put("p_command_id",command.getString("id")).put("p_status",if(failure==null)"succeeded" else "failed").put("p_error",failure ?: ""))
                        }
                    }
                } catch(e:Exception) { if(e is CancellationException)throw e }
                delay(30_000)
            }
            repair.cancel()
            stopSelf()
        }
        return START_STICKY
    }
    private fun rpc(data:JSONObject,name:String,args:JSONObject):JSONObject {
        val url=data.getString("server_url");require(url.startsWith("https://")) { "Recovery requires HTTPS" }
        val anon=data.getString("anon_key")
        val request=Request.Builder().url(url.trimEnd('/')+"/rest/v1/rpc/$name").header("apikey",anon).header("Authorization","Bearer $anon")
            .post(args.toString().toRequestBody("application/json".toMediaType())).build()
        return SupabaseApi.http.newCall(request).execute().use { response->check(response.isSuccessful) { "Recovery server unavailable" };JSONObject(response.body?.string() ?: "{}") }
    }
    override fun onBind(intent:Intent?):IBinder?=null
    override fun onDestroy() { scope.cancel();super.onDestroy() }
}
