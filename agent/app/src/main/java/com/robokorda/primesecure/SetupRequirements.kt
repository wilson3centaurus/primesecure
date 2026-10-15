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

    fun ready(owner: Boolean, enrolled: Boolean, policy: Boolean, catalog: Boolean,
              apps: Boolean, wallpaper: Boolean, notes: Boolean, mediaAccess: Boolean): Boolean =
        owner && enrolled && policy && catalog && apps && wallpaper && notes && mediaAccess
}
