# Approved web apps (agent 0.8.4 / install code 21)

School web apps run in a separate PrimeSecure WebView with no address/search bar and no launcher icon. This uses Android's installed WebView provider, not the PrimeOS browser app. Keep other browser apps blocked. Do not hide or disable the active WebView provider or other protected login components.

## Configure and pilot

1. Install the signed 0.8.4 APK on one enrolled test device through Agent updates. It uses the existing fleet signer and is not test-only.
2. In **Settings > Web filtering**, choose **Only allow listed sites**. **Add Tinkercad starter sites** fills a proposed starting list while retaining existing entries; review it and Save. Per-device policies replace the school policy, so update a device-specific policy if one exists.
3. Open PrimeSecure > App Store > the installed Tinkercad app > **Open**. For standard Trusted Web Activity wrappers, PrimeSecure reads `android.support.customtabs.trusted.DEFAULT_URL` from the launch activity/application metadata. That URL must be explicitly approved; installing an APK never approves a website by itself.
4. Test a school/class-code or email login, the 3D/circuits editor, cloud save, reopening a saved design, restart, policy revocation and links to an unapproved site. Review **Device diagnostics** for `web_host_blocked` events if a required service is missing. These include a hostname only, not URLs, login codes or page content. Add only reviewed dependencies.

The proposed Tinkercad list is a starting configuration, not proof of a complete sign-in/editor session. Autodesk/Google/Microsoft sign-in requirements and WebGL support vary by account and PrimeOS WebView version. Embedded Google sign-in may be rejected. Separate popup windows, downloads, file pickers, camera/microphone permissions, cleartext HTTP and external app schemes are denied in this first viewer. If a site needs those features, it needs a separately reviewed integration; the viewer never falls back to an unrestricted browser.

## Other apps

- Standard HTTPS links can use the same restricted viewer when an allowlist is active. Android may ask the student to choose **School web app** once. PrimeSecure does not force-replace firmware/login browser defaults.
- Supported TWA wrappers can be opened with **Open** in PrimeSecure; their original desktop icon can still insist on a Custom Tabs browser and fail. Use the PrimeSecure entry.
- Other websites can use this route once their actual service/sign-in domains are explicitly approved. Unsupported wrapper formats, hard-coded Chrome/Custom Tabs dependencies and third-party apps with their own embedded browsers are not automatically intercepted. Review those apps individually.
- The viewer is a navigation restriction, not a device-wide network firewall. Android WebView callbacks do not provide complete control of all redirect/resource/WebSocket traffic. School network filtering remains useful for controls across every app.
- Wildcard-only lists, filtering Off and blocklist mode do not enable this restricted viewer. The legacy School Browser launcher remains available only for legacy active non-allowlist configurations. No new standalone browser icon is added in allowlist mode.
- Policy changes close a revoked current site within a few seconds of receipt. Open wrapper approvals are checked against the saved school catalogue every 15 seconds. Offline devices use their last received policy; they cannot receive a new revocation until connected.
- Website cookies/cache are cleared before loading a web app after the device enrollment identity changes. Existing login sessions are otherwise retained for the same enrollment.

The stock PrimeOS launcher remains in place. This feature does not hide another app's icon or change firmware/login/keyboard package protection. Test physical-device behavior before fleet rollout.
