package com.robokorda.primesecure

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.ScanResult
import android.net.wifi.WifiConfiguration
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.*

/** Contained first-boot Wi-Fi joiner; no escape to the rest of Android Settings. */
class SetupWifiActivity : Activity() {
    private val wifi by lazy { applicationContext.getSystemService(WifiManager::class.java) }
    private lateinit var networks: LinearLayout
    private lateinit var status: TextView
    private lateinit var next: Button
    private var registered = false
    private var networkCallbackRegistered = false
    private val scans = object : BroadcastReceiver() { override fun onReceive(context: Context?, intent: Intent?) = showNetworks() }
    private val connectivity = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = scheduleConnectivityRefresh()
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = scheduleConnectivityRefresh()
        override fun onLost(network: Network) = scheduleConnectivityRefresh()
    }

    override fun onCreate(state: Bundle?) { super.onCreate(state); render(); SetupGatePolicy.enter(this) }
    override fun onResume() {
        super.onResume(); SetupGatePolicy.enter(this)
        if (!registered) { @Suppress("DEPRECATION") registerReceiver(scans, IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION)); registered = true }
        registerConnectivityCallback(); requestWifiPermissionIfNeeded(); refresh()
    }
    override fun onPause() {
        if (registered) { unregisterReceiver(scans); registered = false }
        if (networkCallbackRegistered) {
            runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(connectivity) }
            networkCallbackRegistered = false
        }
        super.onPause()
    }
    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus) SetupGatePolicy.configureLikeRequiredNotice(this) }
    @Deprecated("Return only to the PrimeSecure setup gate")
    override fun onBackPressed() { startActivity(Intent(this, SetupGateActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)); finish() }

    private fun render() {
        val body = FirstBootUi.centered(this, 760).apply { gravity = Gravity.CENTER_HORIZONTAL }
        body.addView(FirstBootUi.icon(this, R.drawable.ic_firstboot_wifi, 54, "Wi-Fi"))
        body.addView(FirstBootUi.title(this, "Connect to the internet", 34f))
        body.addView(FirstBootUi.subtitle(this, "Select a Wi-Fi network to continue.", 17f))
        body.addView(FirstBootUi.space(this, 14))
        status = FirstBootUi.text(this, "Looking for networks...", 13f, FirstBootUi.muted, true).apply { gravity = Gravity.CENTER }
        body.addView(status); body.addView(FirstBootUi.space(this, 8))
        networks = FirstBootUi.card(this, 18).apply { setPadding(dp(8), dp(6), dp(8), dp(6)) }
        body.addView(networks, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        body.addView(FirstBootUi.space(this, 8))
        val actions = LinearLayout(this).apply { gravity = Gravity.CENTER; orientation = LinearLayout.HORIZONTAL }
        actions.addView(FirstBootUi.button(this, "Back", true) { onBackPressed() }, LinearLayout.LayoutParams(dp(210), dp(52)).apply { rightMargin = dp(12) })
        next = FirstBootUi.button(this, "Next  →") {
            if (online()) { startActivity(Intent(this, DeviceSetupActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)); finish() }
            else Toast.makeText(this, "Connect to Wi-Fi before continuing.", Toast.LENGTH_LONG).show()
        }
        actions.addView(next, LinearLayout.LayoutParams(dp(210), dp(52))); body.addView(actions)
        setContentView(FirstBootUi.screen(this, body, scroll = true))
    }

    private fun refresh() {
        if (!wifi.isWifiEnabled) wifi.isWifiEnabled = true
        val connected = currentSsid()
        val ready = online()
        status.text = if (ready) "Connected${connected?.let { " to $it" } ?: ""}. You can continue."
            else if (connected != null) "Connected to $connected. Checking internet access..."
            else "Looking for networks..."
        next.isEnabled = ready
        @Suppress("DEPRECATION") runCatching { wifi.startScan() }
        showNetworks()
    }

    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    private fun showNetworks() {
        if (!hasWifiPermissions()) {
            networks.removeAllViews(); networks.addView(FirstBootUi.subtitle(this, "Allow nearby Wi-Fi access to list networks.", 14f)); return
        }
        val unique = runCatching { wifi.scanResults }.getOrDefault(emptyList()).filter { it.SSID.isNotBlank() }
            .groupBy { it.SSID }.map { (_, rows) -> rows.maxByOrNull { it.level }!! }.sortedByDescending { it.level }
        networks.removeAllViews()
        if (unique.isEmpty()) {
            networks.addView(FirstBootUi.subtitle(this, "No networks are visible yet. Wait a moment, then refresh.", 14f))
            if (Settings.Secure.getInt(contentResolver, Settings.Secure.LOCATION_MODE, 0) == 0)
                networks.addView(FirstBootUi.subtitle(this, "Wi-Fi scanning needs location services enabled by a technician.", 12f))
        } else unique.take(8).forEach { result ->
            val security = security(result)
            networks.addView(networkRow(result.SSID, security, result.SSID == currentSsid()) { choose(result, security) })
        }
        networks.addView(networkRow("Other network...", "Enter a hidden network", false) { showOtherNetwork() })
        networks.addView(networkRow("Refresh", "Scan again", false) { refresh() })
    }

    private fun choose(result: ScanResult, security: String) {
        if (security == "Enterprise") {
            AlertDialog.Builder(this).setTitle("Enterprise Wi-Fi").setMessage("Ask an administrator to preconfigure this enterprise network.").setPositiveButton("OK", null).show(); return
        }
        if (security == "Open") connect(result.SSID, null) else showPassword(result.SSID)
    }

    private fun showPassword(ssid: String) {
        val password = EditText(this).apply {
            hint = "Password"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setPadding(dp(16), dp(12), dp(16), dp(12)); background = FirstBootUi.rounded(this@SetupWifiActivity, Color.WHITE, 12, FirstBootUi.line)
        }
        val show = CheckBox(this).apply {
            text = "Show password"
            setOnCheckedChangeListener { _, checked ->
                password.inputType = InputType.TYPE_CLASS_TEXT or if (checked) InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD else InputType.TYPE_TEXT_VARIATION_PASSWORD
                password.setSelection(password.text.length)
            }
        }
        val content = FirstBootUi.card(this).apply {
            addView(FirstBootUi.title(this@SetupWifiActivity, "Connect to $ssid", 25f))
            addView(FirstBootUi.subtitle(this@SetupWifiActivity, "Enter the network password.", 15f))
            addView(FirstBootUi.space(this@SetupWifiActivity, 14)); addView(password); addView(show)
        }
        AlertDialog.Builder(this).setView(content).setNegativeButton("Cancel", null)
            .setPositiveButton("Connect") { _, _ -> connect(ssid, password.text.toString()) }.show()
    }

    private fun showOtherNetwork() {
        val ssid = EditText(this).apply { hint = "Network name (SSID)"; isSingleLine = true }
        val password = EditText(this).apply { hint = "Password (blank for open Wi-Fi)"; isSingleLine = true; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(22), dp(10), dp(22), 0); addView(ssid); addView(password) }
        AlertDialog.Builder(this).setTitle("Other network").setView(box).setNegativeButton("Cancel", null)
            .setPositiveButton("Connect") { _, _ -> ssid.text.toString().trim().takeIf { it.isNotEmpty() }?.let { connect(it, password.text.toString().ifBlank { null }) } }.show()
    }

    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    private fun connect(ssid: String, password: String?) {
        if (!hasWifiPermissions()) { requestWifiPermissionIfNeeded(); Toast.makeText(this, "Allow nearby Wi-Fi access, then choose the network again.", Toast.LENGTH_LONG).show(); return }
        val quoted = "\"${ssid.replace("\"", "\\\"")}\""
        val config = WifiConfiguration().apply {
            SSID = quoted
            if (password == null) allowedKeyManagement.set(WifiConfiguration.KeyMgmt.NONE)
            else { preSharedKey = "\"${password.replace("\"", "\\\"")}\""; allowedKeyManagement.set(WifiConfiguration.KeyMgmt.WPA_PSK) }
        }
        val existing = runCatching { wifi.configuredNetworks }.getOrNull()?.firstOrNull { it.SSID == quoted }
        val networkId = existing?.networkId ?: wifi.addNetwork(config)
        if (networkId < 0 || !wifi.enableNetwork(networkId, true)) { Toast.makeText(this, "Android could not save that network. Check the password and try again.", Toast.LENGTH_LONG).show(); return }
        wifi.reconnect(); status.text = "Connecting to $ssid..."; next.isEnabled = false
        status.postDelayed({ status.text = if (online()) "Connected to $ssid. You can continue." else "Still connecting. Check the password and try again."; next.isEnabled = online(); showNetworks() }, 3500)
    }

    private fun online(): Boolean {
        val cm = getSystemService(ConnectivityManager::class.java); val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun registerConnectivityCallback() {
        if (networkCallbackRegistered) return
        val request = NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build()
        runCatching {
            getSystemService(ConnectivityManager::class.java).registerNetworkCallback(request, connectivity)
            networkCallbackRegistered = true
        }
    }

    private fun scheduleConnectivityRefresh() {
        if (!::status.isInitialized) return
        status.post { if (!isFinishing && !isDestroyed) refreshConnectionState() }
    }

    private fun refreshConnectionState() {
        val connected = currentSsid()
        val ready = online()
        status.text = if (ready) "Connected${connected?.let { " to $it" } ?: ""}. You can continue."
            else if (connected != null) "Connected to $connected. Checking internet access..."
            else "Looking for networks..."
        next.isEnabled = ready
        showNetworks()
    }

    @Suppress("DEPRECATION", "MissingPermission")
    private fun currentSsid(): String? = runCatching { wifi.connectionInfo.ssid?.removeSurrounding("\"") }.getOrNull()?.takeIf { it.isNotBlank() && it != "<unknown ssid>" }

    private fun hasWifiPermissions() = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED &&
        (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || checkSelfPermission(Manifest.permission.NEARBY_WIFI_DEVICES) == PackageManager.PERMISSION_GRANTED)

    private fun requestWifiPermissionIfNeeded() {
        val wanted = buildList {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) add(Manifest.permission.ACCESS_FINE_LOCATION)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && checkSelfPermission(Manifest.permission.NEARBY_WIFI_DEVICES) != PackageManager.PERMISSION_GRANTED) add(Manifest.permission.NEARBY_WIFI_DEVICES)
        }
        if (wanted.isNotEmpty()) requestPermissions(wanted.toTypedArray(), 1709)
    }

    private fun security(result: ScanResult): String = when {
        result.capabilities.contains("EAP", true) -> "Enterprise"
        result.capabilities.contains("WPA", true) || result.capabilities.contains("SAE", true) -> "Password"
        else -> "Open"
    }

    private fun networkRow(ssid: String, detail: String, connected: Boolean, click: () -> Unit) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; isClickable = true; isFocusable = true
        setPadding(dp(14), dp(7), dp(14), dp(7)); background = FirstBootUi.rounded(this@SetupWifiActivity, if (connected) Color.rgb(237, 244, 255) else Color.TRANSPARENT, 10)
        addView(ImageView(this@SetupWifiActivity).apply {
            setImageResource(if (connected) R.drawable.ic_firstboot_check else R.drawable.ic_firstboot_wifi)
            contentDescription = if (connected) "Connected" else "Wi-Fi network"
            setPadding(dp(8), dp(8), dp(8), dp(8))
        }, LinearLayout.LayoutParams(dp(44), dp(44)))
        addView(LinearLayout(this@SetupWifiActivity).apply {
            orientation = LinearLayout.VERTICAL
            addView(FirstBootUi.text(this@SetupWifiActivity, ssid, 15f, FirstBootUi.navy, true))
            addView(FirstBootUi.text(this@SetupWifiActivity, if (connected) "Connected" else detail, 12f, FirstBootUi.muted))
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (detail == "Password") addView(ImageView(this@SetupWifiActivity).apply {
            setImageResource(R.drawable.ic_firstboot_lock)
            contentDescription = "Secured"
        }, LinearLayout.LayoutParams(dp(22), dp(22)))
        setOnClickListener { click() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)).apply { bottomMargin = dp(2) }
    }

    private fun dp(value: Int) = FirstBootUi.dp(this, value)
}
