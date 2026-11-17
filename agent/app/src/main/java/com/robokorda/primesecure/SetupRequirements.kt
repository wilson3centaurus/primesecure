package com.robokorda.primesecure

internal data class StarterResource(val id: String, val size: Long)

/** Initial setup is bounded; the rest of the school library downloads in the background. */
internal object SetupRequirements {
    fun starterResources(resources: List<StarterResource>): Set<String> {
        var remaining = 25L * 1024 * 1024
        return buildSet {
            for (resource in resources.sortedWith(compareBy<StarterResource> { it.size }.thenBy { it.id })) {
                if (size >= 3) break
                if (resource.size >= 0 && resource.size <= remaining) {
                    add(resource.id)
                    remaining -= resource.size
                }
            }
        }
    }

    /**
     * The security boundary must finish before the student reaches the desktop.
     * Apps, books and other learning content are resumable background work and
     * must not hold a PrimeBook hostage on a slow school connection.
     */
    fun readyForDesktop(owner: Boolean, enrolled: Boolean, policy: Boolean, catalog: Boolean): Boolean =
        owner && enrolled && policy && catalog

    fun backgroundComplete(apps: Boolean, wallpaper: Boolean, notes: Boolean, mediaAccess: Boolean): Boolean =
        apps && wallpaper && notes && mediaAccess
}
