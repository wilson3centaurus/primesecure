# PrimeSecure 0.6.1 remote update

This build packages the 0.6.0 native changes as a non-test-only release, version code 7. It is signed with the existing local enrollment key, so enrolled devices signed with that key can receive it through **Agent updates**. The drawable Primebook logo has its correct WebP extension; its image bytes are unchanged.

The upload file is `artifacts/primesecure-0.6.1-7.apk`. Its filename automatically fills version name `0.6.1` and version code `7` in the dashboard. Publishing immediately offers the newest active release to enrolled devices at their next check-in. Devices already on code 7 or higher ignore this offer. A remote update on a real Primebook still needs verification.

The signer SHA-256 must remain:

```
9f83efe0a3d3399f899619ef35eb43df4f51f8c61e237bf1b547dce3482eaa79
```

This is the existing development certificate, deliberately retained for compatibility. A new unrelated production key cannot update these installations. Keep the existing keystore private and backed up; never commit or upload it as an APK artifact.

Build using the existing release signing inputs (`AGENT_KEYSTORE_FILE`, `AGENT_KEYSTORE_PASSWORD`, `AGENT_KEY_ALIAS`, `AGENT_KEY_PASSWORD`) pointed at the same local keystore. Set `AGENT_VERSION_NAME=0.6.1`, `AGENT_VERSION_CODE=7`, and the usual `PRIMESECURE_URL`/`PRIMESECURE_ANON_KEY`, then run `assembleRelease lintRelease`. The release build already sets `testOnly=false` and disables debugging; there is no need to disable the removable debug build used for local development.

Verify with Android SDK `apksigner verify --print-certs` and `aapt dump xmltree` before publishing. The final manifest must have `testOnly=false`, no enabled `debuggable` flag, and package `com.robokorda.primesecure`. Compare the certificate directly with the previously installed APK.

Do not uninstall, clear data, or re-enroll to update. The existing device-owner agent installs the compatible APK in place. The test-only adb removal shortcut does not apply to a non-test-only installation; retain the authenticated dashboard management and retirement path.
