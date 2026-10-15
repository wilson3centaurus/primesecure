# PrimeSecure provisioning request for Primebook

We manage school-owned Primebook WiFi devices running PrimeOS / Android 11. We need to provision approximately 300 devices without operating a terminal on each one. PrimeOS uses its own internet/username/region/phone/OTP setup wizard.

Please confirm a supported way to install our signed DPC and assign it full-device management during this wizard, or transfer management from your existing Device Owner if applicable. We do not want a work profile or legacy Device Admin-only enrollment. Please also confirm whether the management bootstrap survives a factory reset and can require re-enrollment before student access.

Our agent:

- Package: `com.robokorda.primesecure`
- Device admin receiver: `com.robokorda.primesecure/.AdminReceiver`
- Current signer SHA-256: `9f83efe0a3d3399f899619ef35eb43df4f51f8c61e237bf1b547dce3482eaa79`
- Non-test-only release APKs use that existing signer for compatibility.
- Accepts an enrollment key as `token` in Android's provisioning admin-extras bundle or ownership-transfer bundle. The key is redeemed over HTTPS for the device's own restricted account.
- Device Owner transfer support is declared in device-admin metadata. The current owner/manufacturer must authorize any transfer; the app cannot take ownership itself.
- Required apps, school wallpaper, initial notes and school policy are synchronized after successful enrollment. Android and OEM firmware dependencies remain enabled.

We need documentation for:

1. Supported provisioning/ownership-transfer mechanism and required firmware versions.
2. Any PrimeOS setup or portal hooks for a signed third-party DPC, including how each device receives its one-use enrollment key.
3. Reset persistence: supported manufacturer-side serial-to-school assignment and reinstallation/re-enrollment after wipe.
4. Which packages must remain visible/enabled for login, keyboard, launcher, networking and system recovery.
5. A reversible pilot on one device and an authorized management-recovery path before fleet rollout.

Enrollment secrets must not be retrieved from serial numbers through a public unauthenticated endpoint or written into a shared fleet-wide APK. Please provide a secure per-device handoff. We can supply the APK and checksum for a pilot after confirming your supported process.
