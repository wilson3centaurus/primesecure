package com.robokorda.primesecure

import kotlinx.coroutines.CancellationException
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.net.UnknownHostException
import java.security.SignatureException
import java.util.zip.ZipException

class HubInstallRetryRulesTest {
    @Test fun malformedIncompleteSdkAbiAndSignerFailuresAreTerminal() {
        for (error in listOf(
            IllegalArgumentException("APK manifest is too large"),
            IllegalStateException("A base APK is required. Upload the complete .psapk set."),
            IllegalArgumentException("This app requires split APKs"),
            IllegalArgumentException("APK requires Android SDK 31; this device has 30"),
            IllegalArgumentException("APK native libraries are incompatible with device ABIs"),
            IllegalArgumentException("APKs must have the same signing certificates"),
            ZipException("invalid ZIP"), SignatureException("invalid signer"))) {
            assertTrue(error.message, HubInstallRetryRules.terminal(error))
        }
    }
    @Test fun transportServerRateLimitAndTimeoutFailuresRemainRetryable() {
        for (error in listOf(UnknownHostException("dns"), IOException("connection reset"),
            ApiException(503, "unavailable"), ApiException(429, "retry later"), ApiException(401, "authentication"),
            IllegalStateException("App attempt timed out"), IllegalStateException("Storage is nearly full"),
            IllegalArgumentException("App catalog changed during download"), IllegalStateException("The app download is damaged"))) {
            assertFalse(error.message, HubInstallRetryRules.terminal(error))
        }
    }
    @Test fun withdrawalAndMissingApprovedObjectAreTerminal() {
        assertTrue(HubInstallRetryRules.terminal(ApiException(403, "withdrawn")))
        assertTrue(HubInstallRetryRules.terminal(ApiException(404, "missing")))
        assertTrue(HubInstallRetryRules.terminal(IllegalArgumentException("App is no longer approved for this device")))
    }
    @Test fun wrappedNetworkErrorsRemainRetryableAndCancellationPropagates() {
        assertFalse(HubInstallRetryRules.terminal(IllegalStateException("transfer", IOException("offline"))))
        assertThrows(CancellationException::class.java) { HubInstallRetryRules.terminal(CancellationException("manual refresh")) }
    }
    @Test fun sameFailedCatalogObjectIsNotRecreatedWhileChangedHashOrPathCanInstall() {
        val failed = HubInstallRetryRules.identity("school/base.psapk", "ABCD")
        assertFalse(HubInstallRetryRules.shouldAutoEnqueue(HubInstallRetryRules.identity("school/base.psapk", "abcd"), failed, false))
        assertTrue(HubInstallRetryRules.shouldAutoEnqueue(HubInstallRetryRules.identity("school/base.psapk", "newhash"), failed, false))
        assertTrue(HubInstallRetryRules.shouldAutoEnqueue(HubInstallRetryRules.identity("school/new.psapk", "abcd"), failed, false))
        // Retry creates a pending manual task; the automatic path must not duplicate it.
        assertFalse(HubInstallRetryRules.shouldAutoEnqueue(failed, failed, true))
        // A successful Retry clears the failure checkpoint.
        assertTrue(HubInstallRetryRules.shouldAutoEnqueue(failed, null, false))
    }
}
