package com.robokorda.primesecure

internal object ActiveRoleSafety {
    // An unresolved chooser is not evidence that any candidate can be removed.
    fun protectedPackages(selected:String?,candidates:Set<String>):Set<String> =
        if(selected!=null && selected in candidates) setOf(selected) else candidates
}
