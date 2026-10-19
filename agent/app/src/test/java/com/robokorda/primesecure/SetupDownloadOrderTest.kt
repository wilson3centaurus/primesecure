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
    @Test fun imagesPrecedeDocumentsWhileDocumentsRetainRoboticsThenExplorePriority() {
        val input = listOf(SetupDownload("doc", "resource", 1),
            SetupDownload("robot-big", "resource", 500, subject="ROBOTICS"),
            SetupDownload("robot-small", "resource", 300, title="Robotics introduction"),
            SetupDownload("explore", "resource", 200, form="Explore & grow"),
            SetupDownload("photo", "resource", 100, mime="image/jpeg"),
            SetupDownload("images", "resource", 150, category="Images"))
        assertEquals(listOf("photo", "images", "robot-small", "robot-big", "explore", "doc"), SetupDownloadOrder.ordered(input).map { it.id })
    }
    @Test fun explicitStreamOrderIsWallpaperImagesAppsDocumentsWithNotePrioritiesWithinEach() {
        val input = listOf(SetupDownload("doc", "resource", 1, mime="application/pdf"),
            SetupDownload("app", "app", 1), SetupDownload("wall", "wallpaper", 1000),
            SetupDownload("image", "resource", 1, mime="image/jpeg"),
            SetupDownload("robot-image", "resource", 900, subject="Robotics", mime="image/png"),
            SetupDownload("explore-image", "resource", 500, form="Explore and grow", mime="image/webp"),
            SetupDownload("robot-doc", "resource", 900, subject="Robotics", mime="application/pdf"),
            SetupDownload("explore-doc", "resource", 500, form="Explore & grow", mime="application/pdf"))
        assertEquals(listOf("wall", "robot-image", "explore-image", "image", "app", "robot-doc", "explore-doc", "doc"),
            SetupDownloadOrder.ordered(input.reversed()).map { it.id })
    }
    @Test fun detectsMissingMimeImagesByPathButDoesNotPromoteDocumentsWithImageInTheirCategory() {
        val items = listOf(SetupDownload("doc", "resource", 1, category="Images", mime="application/pdf"),
            SetupDownload("image", "resource", 100, storagePath="school/photo.JPG"), SetupDownload("app", "app", 1))
        assertEquals(listOf("image", "app", "doc"), SetupDownloadOrder.ordered(items).map { it.id })
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
    @Test fun aNewWallpaperDiscoveredDuringThePassPreemptsRemainingApps() = runBlocking {
        val items = mutableListOf(SetupDownload("app-1", "app", 1), SetupDownload("app-2", "app", 2),
            SetupDownload("doc", "resource", 1))
        val seen = mutableListOf<String>()
        val pass = SetupDownloadOrder.runBoundedPass(load = { items.toList() }, now = { 0L }) { item, _ ->
            seen += item.id
            if (item.id == "app-1") items += SetupDownload("new-wall", "wallpaper", 100)
            true
        }
        assertEquals(listOf("app-1", "new-wall", "app-2", "doc"), seen)
        assertFalse(pass.deferred)
        assertTrue(pass.successful)
    }
    @Test fun itemAndTimeBudgetsYieldInsteadOfHoldingOneWorkerForTheEntireCatalog() = runBlocking {
        val items = (1..5).map { SetupDownload("app-$it", "app", it.toLong()) }
        val countBound = SetupDownloadOrder.runBoundedPass(load = { items }, now = { 0L }, maxItems = 2) { _, _ -> true }
        assertEquals(2, countBound.attempted)
        assertTrue(countBound.deferred)
        var clock = 0L
        val budgets = mutableListOf<Long>()
        val timeBound = SetupDownloadOrder.runBoundedPass(load = { items }, now = { clock }, maxMillis = 100_000L) { _, budget ->
            budgets += budget
            clock += budget
            true
        }
        assertEquals(listOf(90_000L, 10_000L), budgets)
        assertTrue(timeBound.deferred)
        assertEquals(2, timeBound.attempted)
    }
    @Test fun failedEarlyStreamsCannotOccupyEveryBoundedBatchAndStarveLaterStreams() = runBlocking {
        val pending = ((1..10).map { SetupDownload("wall-$it", "wallpaper", it.toLong()) } +
            listOf(SetupDownload("image", "resource", 1, mime="image/jpeg"), SetupDownload("app", "app", 1), SetupDownload("doc", "resource", 1))).toMutableList()
        val failures = mutableSetOf<String>()
        val seen = mutableListOf<String>()
        var pass: SetupPassResult
        var batches = 0
        do {
            pass = SetupDownloadOrder.runBoundedPass(load = { pending.toList() }, now = { 0L },
                deferredFailures = failures, maxItems = 3, record = { item, success -> if (!success) failures += item.workKey }) { item, _ ->
                seen += item.id
                if (item.kind != "wallpaper") pending.remove(item)
                item.kind != "wallpaper"
            }
            batches++
            assertTrue("The round must finish despite failed wallpapers", batches <= 5)
        } while (pass.deferred)
        assertEquals(13, seen.size)
        assertEquals(13, seen.toSet().size)
        assertEquals(listOf("image", "app", "doc"), seen.takeLast(3))
    }
    @Test fun correctedCatalogObjectDoesNotInheritAnOldFailureCheckpoint() = runBlocking {
        val old = SetupDownload("wall", "wallpaper", 10, storagePath="wall.jpg", sha256="old")
        val corrected = old.copy(sha256 = "corrected")
        var calls = 0
        val pass = SetupDownloadOrder.runBoundedPass(load = { listOf(corrected) }, now = { 0L }, deferredFailures = setOf(old.workKey)) { _, _ ->
            calls++; true
        }
        assertEquals(1, calls)
        assertTrue(pass.successful)
    }
    @Test fun cancelledAttemptIsNotCheckpointedAsFailureOrSuccess() = runBlocking {
        var recorded = false
        try {
            SetupDownloadOrder.runBoundedPass(load = { listOf(SetupDownload("wall", "wallpaper", 1)) }, now = { 0L },
                record = { _, _ -> recorded = true }) { _, _ -> throw CancellationException("manual refresh") }
            fail("Cancellation should propagate")
        } catch (_: CancellationException) { assertFalse(recorded) }
    }
    @Test fun onlyExplicitForceReplacesRunningWorkWhileRoutineCheckinsKeepIt() {
        assertEquals(HubSyncQueuePolicy.KEEP, HubSyncScheduling.policy(followUp = false, force = false))
        assertEquals(HubSyncQueuePolicy.APPEND, HubSyncScheduling.policy(followUp = true, force = false))
        assertEquals(HubSyncQueuePolicy.REPLACE, HubSyncScheduling.policy(followUp = false, force = true))
        assertEquals(HubSyncQueuePolicy.REPLACE, HubSyncScheduling.policy(followUp = true, force = true))
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
