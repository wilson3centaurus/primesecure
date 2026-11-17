package com.robokorda.primesecure

import android.content.Context

/** Local-only fixture state for FIRST_BOOT_TEST_MODE. Never writes AgentStore enrollment. */
internal class FirstBootTestStore(context: Context) {
    private val prefs = context.getSharedPreferences("first-boot-offline-test", Context.MODE_PRIVATE)
    var studentName: String
        get() = prefs.getString("student", "Test Student") ?: "Test Student"
        set(value) { prefs.edit().putString("student", value).apply() }
    var existing: Boolean
        get() = prefs.getBoolean("existing", false)
        set(value) { prefs.edit().putBoolean("existing", value).apply() }
    var phone: String
        get() = prefs.getString("phone", if (existing) "+263 77 123 4567" else "") ?: ""
        set(value) { prefs.edit().putString("phone", value).apply() }
    var region: String
        get() = prefs.getString("region", "Harare") ?: "Harare"
        set(value) { prefs.edit().putString("region", value).apply() }
    var classForm: String
        get() = prefs.getString("class_form", "1") ?: "1"
        set(value) { prefs.edit().putString("class_form", value).apply() }
    var classSection: String
        get() = prefs.getString("class_section", "A") ?: "A"
        set(value) { prefs.edit().putString("class_section", value).apply() }
    var licenceAccepted: Boolean
        get() = prefs.getBoolean("licence_accepted", false)
        set(value) { prefs.edit().putBoolean("licence_accepted", value).commit() }
    var deviceSetupComplete: Boolean
        get() = prefs.getBoolean("device_setup_complete", false)
        set(value) { prefs.edit().putBoolean("device_setup_complete", value).commit() }
    val school = "Rusununguko ZIMFEP High School"
    val assignmentDate = "3 November 2026"

    fun existingFixture() {
        prefs.edit().putBoolean("existing", true).putString("student", "Tafadzwa Moyo")
            .putString("phone", "+263 77 123 4567").putString("region", "Harare")
            .putString("class_form", "3").putString("class_section", "A").commit()
    }
    fun newFixture(name: String) {
        prefs.edit().putBoolean("existing", false).putString("student", name).putString("phone", "")
            .putString("region", "Harare").putString("class_form", "1").putString("class_section", "A").commit()
    }
    fun reset() { prefs.edit().clear().commit() }
}
