package com.robokorda.primesecure

/** Pure policy selection; platform/OEM safety always takes precedence over app approval. */
internal object AppVisibilityRules {
    fun hiddenPackages(
        requested: Set<String>, allowed: Set<String>, launchable: Set<String>,
        previouslyRestricted: Set<String>, protected: Set<String>, allowListOnly: Boolean,
    ): Set<String> = buildSet {
        addAll(requested)
        if (allowed.isNotEmpty() || allowListOnly) {
            (launchable + previouslyRestricted).filterTo(this) { it !in allowed }
        }
    } - protected
}
