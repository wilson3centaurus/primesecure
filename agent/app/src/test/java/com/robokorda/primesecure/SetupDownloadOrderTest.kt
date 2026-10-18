package com.robokorda.primesecure

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class SetupDownloadOrderTest {
    @Test fun actualPassRunsEveryWallpaperBeforeAppsAndNotesSmallestFirst() = runBlocking {
        val input = listOf(SetupDownload("book", "resource", 1), SetupDownload("app-big", "app", 300),
            SetupDownload("wall-big", "wallpaper", 200), SetupDownload("app-small", "app", 100), SetupDownload("wall-small", "wallpaper", 20))
        val seen = mutableListOf<String>()
        assertTrue(SetupDownloadOrder.runPass(input) { seen.add(it.id); true })
        assertEquals(listOf("wall-small", "wall-big", "app-small", "app-big", "book"), seen)
    }
    @Test fun roboticsThenEntireExploreAndImagesThenOtherDocuments() {
        val input = listOf(SetupDownload("doc", "resource", 1),
            SetupDownload("robot-big", "resource", 500, subject="ROBOTICS"),
            SetupDownload("robot-small", "resource", 300, title="Robotics introduction"),
            SetupDownload("explore", "resource", 200, form="Explore & grow"),
            SetupDownload("photo", "resource", 100, mime="image/jpeg"),
            SetupDownload("images", "resource", 150, category="Images"))
        assertEquals(listOf("robot-small", "robot-big", "photo", "images", "explore", "doc"), SetupDownloadOrder.ordered(input).map { it.id })
    }
    @Test fun orderingIsStableAndUnknownSizesGoLastInTheirPriority() {
        val items = listOf(SetupDownload("b", "app", 1), SetupDownload("bad", "app", -1), SetupDownload("a", "app", 1))
        assertEquals(listOf("a", "b", "bad"), SetupDownloadOrder.ordered(items.reversed()).map { it.id })
    }
    @Test fun permanentlyFailedWallpapersDoNotStarveAnyLaterStream() = runBlocking {
        val items = listOf(SetupDownload("wall", "wallpaper", 1), SetupDownload("app", "app", 1), SetupDownload("notes", "resource", 1))
        val seen = mutableListOf<String>()
        repeat(3) { assertFalse(SetupDownloadOrder.runPass(items) { seen.add(it.id); it.kind != "wallpaper" }) }
        assertEquals(List(3) { listOf("wall", "app", "notes") }.flatten(), seen)
    }
    @Test fun cancellationStopsThePassRatherThanPretendingSuccess() = runBlocking {
        var calls = 0
        try {
            SetupDownloadOrder.runPass(listOf(SetupDownload("wall", "wallpaper", 1), SetupDownload("app", "app", 1))) {
                calls++; throw CancellationException("worker stopped")
            }
            fail("Cancellation should propagate")
        } catch (_: CancellationException) { assertEquals(1, calls) }
    }
    @Test fun emptyUnknownCatalogueIsNotFinishedButKnownEmptyCatalogueIs() {
        assertFalse(SetupProgressMath.complete(false, 0, 0))
        assertTrue(SetupProgressMath.complete(true, 0, 0))
        assertFalse(SetupProgressMath.complete(true, 3, 2))
    }
    @Test fun bytesAreClampedAndUnknownSizesAreNotInvented() {
        assertEquals(100L, SetupProgressMath.received(100, 500, false))
        assertEquals(0L, SetupProgressMath.received(-1, 500, true))
        assertEquals(100L, SetupProgressMath.received(100, 0, true))
    }
    @Test fun sameBootUsesMonotonicTimeEvenIfWallClockChanges() {
        val next = SetupProgressMath.tick(SetupClockReading(10, 1000, 10000, 1), 2000, 9000, 1)
        assertEquals(1010L, next.elapsed)
        assertTrue(next.estimated)
    }
    @Test fun offlineRebootGapIsIncludedButExplicitlyEstimated() {
        val next = SetupProgressMath.tick(SetupClockReading(10, 10000, 10000, 1), 100, 16000, 2)
        assertEquals(6010L, next.elapsed)
        assertTrue(next.estimated)
    }
}
