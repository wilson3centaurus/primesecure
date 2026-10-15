# Request to Primebook / Floydwiz: reset persistence and supported school lockdown

Prepared for the school administrator to send. This request has not been sent.

We manage approximately 300 school-owned Primebook WiFi laptops running PrimeOS / Android 11. Your custom setup wizard requires internet, username, region, phone number and OTP. Students can currently wipe the user partition through hardware recovery, removing our user-installed management app, content and Device Owner enrollment.

Please supply a supported manufacturer integration for:

1. Assigning a device's verified Prime ID / serial to a school in your provisioning service.
2. Installing the school's signed DPC and assigning Device Owner during your setup wizard, or authorized ownership transfer from your existing owner.
3. Retaining school assignment outside the wiped user partition, requiring secure re-enrollment before student desktop access after reset. The server must authenticate the device; a public MAC-to-enrollment-secret lookup is not acceptable.
4. Documented enterprise factory-reset protection supported by your firmware, and an administrator-authorized recovery/reset workflow. Confirm which hardware recovery, safe mode and bootloader/flash paths remain available. We need signed manufacturer support rather than an ADB or root exploit.
5. USB mass-storage and SD-card mounting prevention at the OS/storage layer, incoming Bluetooth file-transfer blocking, removal of guest/add-user entry points in the custom login, and supported restrictions on the OEM browser/store/settings without breaking login, keyboard, WebView or updates.
6. A documented device identity API returning the printed Prime ID, and any requirements for Usage Access and accurate Wi-Fi/location reporting.
7. A reversible pilot, audited recovery code/key management, signing-key rotation, supported firmware update procedure, and a manufacturer rollback/recovery plan before fleet deployment.

Our DPC package is `com.robokorda.primesecure`, receiver `com.robokorda.primesecure/.AdminReceiver`, signer SHA-256 `9f83efe0a3d3399f899619ef35eb43df4f51f8c61e237bf1b547dce3482eaa79`. It accepts a one-use school enrollment token in authorized provisioning/ownership-transfer extras. No school service key or shared fleet recovery password is embedded in the APK.

PrimeSecure currently requests standard Android restrictions. `DISALLOW_FACTORY_RESET` covers Settings-triggered resets; it does not guarantee prevention of hardware recovery wipes or reflashing. Once a factory reset removes a normal user-installed APK, that APK cannot reinstall itself. We need your OEM bootstrap/assignment service to supply that missing capability.
