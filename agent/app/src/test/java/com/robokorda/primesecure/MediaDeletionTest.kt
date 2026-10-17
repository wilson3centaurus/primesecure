package com.robokorda.primesecure

import org.junit.Assert.*
import org.junit.Test
import org.junit.Rule
import org.junit.rules.TemporaryFolder
import java.io.File

class MediaDeletionTest {
    @get:Rule val temporary=TemporaryFolder()
    @Test fun deletesOnlySelectedFileAndKeepsNeighbours() {
        val selected=temporary.newFile("photo.jpg").apply { writeText("photo") }
        val neighbour=temporary.newFile("keep.mp3").apply { writeText("music") }
        MediaDeletion.delete(selected,MediaDeletion.snapshot(selected))
        assertFalse(selected.exists());assertTrue(neighbour.exists())
    }
    @Test fun rejectsDirectoriesWithoutRemovingContents() {
        val dir=temporary.newFolder();val child=File(dir,"keep.jpg").apply { writeText("keep") }
        assertThrows(IllegalStateException::class.java) { MediaDeletion.delete(dir,MediaDeletion.snapshot(dir)) }
        assertTrue(child.exists())
    }
    @Test fun refusesChangedFileAfterConfirmationSnapshot() {
        val selected=temporary.newFile().apply { writeText("original") };val snapshot=MediaDeletion.snapshot(selected)
        selected.writeText("new content with different size")
        assertThrows(IllegalStateException::class.java) { MediaDeletion.delete(selected,snapshot) }
        assertTrue(selected.exists())
    }
    @Test fun refusesDifferentTargetEvenWithMatchingSizeAndTimestamp() {
        val selected=temporary.newFile().apply { writeText("one") };val snapshot=MediaDeletion.snapshot(selected)
        val other=temporary.newFile().apply { writeText("two");setLastModified(snapshot.modified) }
        assertThrows(IllegalStateException::class.java) { MediaDeletion.delete(other,snapshot) }
        assertTrue(selected.exists());assertTrue(other.exists())
    }
}
