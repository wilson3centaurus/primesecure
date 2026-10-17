package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Test
import org.junit.Rule
import org.junit.rules.TemporaryFolder
import java.io.File

class MediaDiscoveryTest {
    @get:Rule val temporary = TemporaryFolder()
    private fun put(root:File,path:String):File = File(root,path).apply { parentFile.mkdirs();writeText("test") }
    @Test fun discoversCustomDownloadsCameraAndAndroidMediaWithoutInventoryCrowding() {
        val root=temporary.newFolder()
        repeat(5100) { put(root,"unrelated/item$it.bin") }
        put(root,"NewPipe/My selection/lesson.MP3")
        put(root,"DCIM/Camera/clip.mp4")
        put(root,"DCIM/Camera/photo.jpg")
        put(root,"Android/media/org.example/recording.opus")
        put(root,"Android/data/org.example/private.mp3")
        put(root,".hidden/photo.jpg")
        val result=MediaDiscovery.scan(mapOf(root to ""))
        assertEquals(setOf("lesson.MP3","clip.mp4","photo.jpg","recording.opus"),result.files.map { it.second.name }.toSet())
        assertFalse(result.truncated)
    }
    @Test fun removablePathsRetainVolumeAndLimitsAreReported() {
        val root=temporary.newFolder()
        put(root,"recordings/music.mp3");put(root,"recordings/film.mp4")
        val result=MediaDiscovery.scan(mapOf(root to "@usb/ABCD-1234"),limit=1)
        assertEquals(1,result.files.size)
        assertTrue(result.files.single().first.startsWith("@usb/ABCD-1234/recordings/"))
        assertTrue(result.truncated)
    }
    @Test fun linksCannotEscapeTheSharedRoot() {
        val root=temporary.newFolder();val outside=temporary.newFolder();put(outside,"secret.mp3")
        try { java.nio.file.Files.createSymbolicLink(File(root,"linked").toPath(),outside.toPath()) }
        catch(_:java.nio.file.FileSystemException) { return } // Windows may deny symlink creation.
        assertTrue(MediaDiscovery.scan(mapOf(root to "")).files.isEmpty())
    }
}
