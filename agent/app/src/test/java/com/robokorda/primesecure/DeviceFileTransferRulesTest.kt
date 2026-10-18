package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Test

class DeviceFileTransferRulesTest {
    @Test fun permitsOnlyNormalSharedPaths() {
        listOf("Download/photo.jpg","Documents/Robotics notes.pdf","@usb/ABCD-1234/Movies/film.mp4").forEach { assertTrue(it,DeviceFileTransferRules.validPath(it)) }
        listOf("","/etc/passwd","../secret","Download/../secret","Download/./secret","Download//a","Download/","Download\\a", "Download/a:stream", ".hidden/a", "Download/.private/a", "Android/data/x/a", "android/OBB/x", "@usb/ABCD-1234/Android/data/x", "@usb/fake/file", "@usb/ABCD-1234", "@other/file", "Download/\u0000a").forEach { assertFalse(it,DeviceFileTransferRules.validPath(it)) }
    }
    @Test fun exactMetadataAnd500MbCeiling() {
        assertEquals(500_000_000L,DeviceFileTransferRules.MAX_BYTES)
        DeviceFileTransferRules.validateMetadata(0,0,0,0)
        DeviceFileTransferRules.validateMetadata(DeviceFileTransferRules.MAX_BYTES,123,DeviceFileTransferRules.MAX_BYTES,123)
        for(args in listOf(longArrayOf(10,20,11,20),longArrayOf(10,20,10,21),longArrayOf(-1,20,-1,20),longArrayOf(1,-1,1,-1),longArrayOf(DeviceFileTransferRules.MAX_BYTES+1,1,DeviceFileTransferRules.MAX_BYTES+1,1))) {
            try { DeviceFileTransferRules.validateMetadata(args[0],args[1],args[2],args[3]); fail("Must reject invalid metadata") } catch(_:IllegalArgumentException) {}
        }
    }
}
