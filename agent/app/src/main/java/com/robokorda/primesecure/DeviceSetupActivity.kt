package com.robokorda.primesecure

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.*
import kotlinx.coroutines.*
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Six-digit school verification, server assignment recovery and first enrollment. */
class DeviceSetupActivity : Activity() {
    private val classForms = (1..6).map { "Form $it" }
    private val classSections = ('A'..'Z').map(Char::toString)
    private val scope = MainScope()
    private val setup by lazy { DeviceSetupStore(this) }
    private val api by lazy { DeviceSetupApi(this) }
    private var busy = false
    private var completingManagement = false

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        if (AgentStore(this).isEnrolled) { openPreparation(); return }
        if (BuildConfig.FIRST_BOOT_TEST_MODE && setup.sessionId != null &&
            setup.sessionId?.startsWith("offline-test-") != true) setup.clear()
        render(); SetupGatePolicy.enter(this); completeManagedSetup(intent)
    }
    override fun onNewIntent(value: Intent) { super.onNewIntent(value); intent = value; SetupGatePolicy.enter(this); completeManagedSetup(value) }
    override fun onResume() { super.onResume(); if (!AgentStore(this).isEnrolled) SetupGatePolicy.enter(this) }
    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus) SetupGatePolicy.configureLikeRequiredNotice(this) }
    override fun onDestroy() { scope.cancel(); super.onDestroy() }
    @Deprecated("Setup cannot be skipped")
    override fun onBackPressed() { startActivity(Intent(this, SetupWifiActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)); finish() }

    private fun render() {
        val content = when {
            setup.sessionId == null -> verificationScreen()
            setup.assignmentState == "assigned" -> assignmentScreen()
            else -> studentScreen()
        }
        setContentView(FirstBootUi.screen(this, content, scroll = true))
    }

    private fun verificationScreen() = FirstBootUi.centered(this, 760).apply {
        addView(FirstBootUi.icon(this@DeviceSetupActivity, R.drawable.ic_firstboot_verify, 54, "Verify device"))
        addView(FirstBootUi.title(this@DeviceSetupActivity, "Verify your PrimeBook", 34f))
        addView(FirstBootUi.subtitle(this@DeviceSetupActivity, "Enter the six-digit setup code provided by your school.", 17f))
        addView(FirstBootUi.space(this@DeviceSetupActivity, 24))
        val code = EditText(this@DeviceSetupActivity).apply {
            hint = "—  —  —  —  —  —"; inputType = InputType.TYPE_CLASS_NUMBER; filters = arrayOf(InputFilter.LengthFilter(6))
            gravity = Gravity.CENTER; textSize = 30f; letterSpacing = .28f; isSingleLine = true
            setPadding(dp(16), dp(12), dp(16), dp(12)); background = FirstBootUi.rounded(this@DeviceSetupActivity, Color.WHITE, 14, FirstBootUi.line)
        }
        addView(code, LinearLayout.LayoutParams(dp(610), dp(70)).apply { gravity = Gravity.CENTER_HORIZONTAL })
        addView(FirstBootUi.space(this@DeviceSetupActivity, 10))
        addView(FirstBootUi.subtitle(this@DeviceSetupActivity, if (BuildConfig.FIRST_BOOT_TEST_MODE)
            "TEST ONLY: 000000 = existing student  ·  123456 = new student"
        else "Setup codes expire shortly. Ask your school for a new code if needed.", 14f))
        addView(FirstBootUi.space(this@DeviceSetupActivity, 12))
        addView(FirstBootUi.button(this@DeviceSetupActivity, "Verify") {
            val typed = code.text.toString().trim()
            if (!typed.matches(Regex("^[0-9]{6}$"))) { toast("Enter all six digits from your school setup code."); return@button }
            code.clearFocus(); getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(code.windowToken, 0)
            if (BuildConfig.FIRST_BOOT_TEST_MODE) {
                val fixture = FirstBootTestStore(this@DeviceSetupActivity)
                setup.hardwareId = PrimeBookIdentity.displayId(this@DeviceSetupActivity)
                when (typed) {
                    "000000" -> {
                        fixture.existingFixture()
                        setup.sessionId = "offline-test-existing"
                        setup.assignmentState = "assigned"
                        setup.schoolName = fixture.school
                        setup.studentName = fixture.studentName
                        setup.assignmentDate = "2026-11-03T00:00:00Z"
                        setup.classForm = fixture.classForm
                        setup.classSection = fixture.classSection
                        render()
                    }
                    "123456" -> {
                        setup.sessionId = "offline-test-new"
                        setup.assignmentState = "unassigned"
                        setup.schoolName = fixture.school
                        setup.studentName = null
                        setup.assignmentDate = null
                        render()
                    }
                    else -> toast("TEST BUILD: use 000000 for an existing student or 123456 for a new student.")
                }
                return@button
            }
            launch("Verifying this PrimeBook...") {
                val identity = DeviceInfo.collect(this@DeviceSetupActivity)
                val stable = PrimeBookIdentity.json(this@DeviceSetupActivity)
                stable.keys().forEach { identity.put(it, stable.get(it)) }
                val result = api.verifyCode(setup.requestSecret, typed, identity)
                setup.sessionId = result.getString("session_id")
                setup.assignmentState = result.getString("assignment_state")
                setup.schoolName = result.optString("school_name").takeIf { it.isNotBlank() }
                setup.studentName = result.optString("student_name").takeIf { it.isNotBlank() }
                setup.assignmentDate = result.optString("assignment_date").takeIf { it.isNotBlank() }
                setup.classForm = result.optInt("class_form").takeIf { it in 1..6 }?.toString()
                setup.classSection = result.optString("class_section").takeIf { it.matches(Regex("^[A-Z]{1,4}$")) }
                setup.hardwareId = result.optString("hardware_id").takeIf { it.isNotBlank() } ?: PrimeBookIdentity.displayId(this@DeviceSetupActivity)
                render()
            }
        }, LinearLayout.LayoutParams(dp(580), dp(54)).apply { gravity = Gravity.CENTER_HORIZONTAL })
        addView(FirstBootUi.button(this@DeviceSetupActivity, "Back", true) { onBackPressed() }, LinearLayout.LayoutParams(dp(580), dp(52)).apply { gravity = Gravity.CENTER_HORIZONTAL })
    }

    private fun assignmentScreen() = FirstBootUi.centered(this, 820).apply {
        addView(FirstBootUi.icon(this@DeviceSetupActivity, R.drawable.ic_firstboot_check, 58, "Assignment found"))
        addView(FirstBootUi.title(this@DeviceSetupActivity, "This PrimeBook is already assigned", 32f))
        addView(FirstBootUi.subtitle(this@DeviceSetupActivity, "Check the student details below.", 16f))
        addView(FirstBootUi.space(this@DeviceSetupActivity, 18))
        val details = FirstBootUi.card(this@DeviceSetupActivity).apply {
            addView(detailRow("Student name", setup.studentName ?: "Student"))
            addView(detailRow("School", setup.schoolName ?: "Assigned school"))
            addView(detailRow("Assignment date", formattedDate(setup.assignmentDate)))
            addView(detailRow("Class", classLabel()))
            addView(detailRow("Prime ID", setup.hardwareId ?: PrimeBookIdentity.displayId(this@DeviceSetupActivity), last = true))
        }
        addView(details, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        addView(FirstBootUi.space(this@DeviceSetupActivity, 10))
        addView(FirstBootUi.subtitle(this@DeviceSetupActivity, "🔒  These details can only be updated by your school.", 14f))
        addView(FirstBootUi.space(this@DeviceSetupActivity, 14))
        addView(FirstBootUi.button(this@DeviceSetupActivity, "Continue") { activateExisting() }, LinearLayout.LayoutParams(dp(540), dp(54)).apply { gravity = Gravity.CENTER_HORIZONTAL })
        addView(FirstBootUi.button(this@DeviceSetupActivity, "Back", true) { resetVerification() }, LinearLayout.LayoutParams(dp(540), dp(52)).apply { gravity = Gravity.CENTER_HORIZONTAL })
    }

    private fun studentScreen() = FirstBootUi.centered(this, 800).apply {
        addView(FirstBootUi.icon(this@DeviceSetupActivity, R.drawable.ic_firstboot_user, 54, "Student"))
        addView(FirstBootUi.title(this@DeviceSetupActivity, "Who will use this PrimeBook?", 34f))
        addView(FirstBootUi.subtitle(this@DeviceSetupActivity, "Enter the student's name to get started.", 17f))
        addView(FirstBootUi.space(this@DeviceSetupActivity, 22))
        addView(FirstBootUi.text(this@DeviceSetupActivity, "STUDENT NAME", 12f, FirstBootUi.navy, true))
        val name = EditText(this@DeviceSetupActivity).apply {
            hint = "Full name"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS; isSingleLine = true
            setText(setup.studentName.orEmpty()); setPadding(dp(16), dp(12), dp(16), dp(12)); background = FirstBootUi.rounded(this@DeviceSetupActivity, Color.WHITE, 13, FirstBootUi.line)
        }
        addView(name, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(62)))
        addView(FirstBootUi.space(this@DeviceSetupActivity, 12))
        addView(FirstBootUi.text(this@DeviceSetupActivity, "CLASS", 12f, FirstBootUi.navy, true))
        val classRow = LinearLayout(this@DeviceSetupActivity).apply { orientation = LinearLayout.HORIZONTAL }
        val form = Spinner(this@DeviceSetupActivity).apply {
            adapter = ArrayAdapter(this@DeviceSetupActivity, android.R.layout.simple_spinner_dropdown_item, classForms)
            setSelection((setup.classForm?.toIntOrNull()?.minus(1) ?: 0).coerceIn(0, 5))
            background = FirstBootUi.rounded(this@DeviceSetupActivity, Color.WHITE, 13, FirstBootUi.line)
        }
        val section = Spinner(this@DeviceSetupActivity).apply {
            adapter = ArrayAdapter(this@DeviceSetupActivity, android.R.layout.simple_spinner_dropdown_item, classSections)
            setSelection(classSections.indexOf(setup.classSection ?: "A").coerceAtLeast(0))
            background = FirstBootUi.rounded(this@DeviceSetupActivity, Color.WHITE, 13, FirstBootUi.line)
        }
        classRow.addView(form, LinearLayout.LayoutParams(0, dp(62), 1f).apply { marginEnd = dp(8) })
        classRow.addView(section, LinearLayout.LayoutParams(0, dp(62), 1f).apply { marginStart = dp(8) })
        addView(classRow, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(62)))
        addView(FirstBootUi.space(this@DeviceSetupActivity, 12))
        addView(FirstBootUi.subtitle(this@DeviceSetupActivity, "Your school can update these details later.", 14f))
        addView(FirstBootUi.space(this@DeviceSetupActivity, 16))
        addView(FirstBootUi.button(this@DeviceSetupActivity, "Continue") {
            val student = name.text.toString().trim()
            if (student.length !in 2..160) { toast("Enter the student's full name."); return@button }
            val selectedForm = form.selectedItemPosition + 1
            val selectedSection = section.selectedItem.toString()
            setup.classForm = selectedForm.toString(); setup.classSection = selectedSection
            if (BuildConfig.FIRST_BOOT_TEST_MODE && setup.sessionId == "offline-test-new") {
                FirstBootTestStore(this@DeviceSetupActivity).apply {
                    newFixture(student); classForm = selectedForm.toString(); classSection = selectedSection
                }
                setup.studentName = student
                openOfflinePreparation()
                return@button
            }
            launch("Creating the student assignment...") {
                val result = api.assign(setup.requestSecret, setup.sessionId!!, student, selectedForm, selectedSection)
                setup.studentName = result.optString("student_name", student); setup.enrollmentKey = result.getString("enroll_token")
                enrollAndPrepare(setup.enrollmentKey!!)
            }
        }, LinearLayout.LayoutParams(dp(550), dp(54)).apply { gravity = Gravity.CENTER_HORIZONTAL })
        addView(FirstBootUi.button(this@DeviceSetupActivity, "Back", true) { resetVerification() }, LinearLayout.LayoutParams(dp(550), dp(52)).apply { gravity = Gravity.CENTER_HORIZONTAL })
    }

    private fun detailRow(label: String, value: String, last: Boolean = false) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(7), 0, dp(7))
        addView(FirstBootUi.text(this@DeviceSetupActivity, label, 14f, FirstBootUi.muted), LinearLayout.LayoutParams(dp(230), ViewGroup.LayoutParams.WRAP_CONTENT))
        addView(FirstBootUi.text(this@DeviceSetupActivity, value, 15f, FirstBootUi.navy, true), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (!last) background = FirstBootUi.rounded(this@DeviceSetupActivity, Color.TRANSPARENT, 0, FirstBootUi.line)
    }

    private fun activateExisting() {
        if (BuildConfig.FIRST_BOOT_TEST_MODE && setup.sessionId == "offline-test-existing") {
            FirstBootTestStore(this).existingFixture()
            openOfflinePreparation()
            return
        }
        launch("Restoring this PrimeBook's school assignment...") {
            val result = api.activate(setup.requestSecret, setup.sessionId!!)
            setup.enrollmentKey = result.getString("enroll_token"); enrollAndPrepare(setup.enrollmentKey!!)
        }
    }

    private fun openOfflinePreparation() {
        startActivity(Intent(this, OfflineTestPreparationActivity::class.java))
        finish()
    }

    private suspend fun enrollAndPrepare(token: String) {
        if (AdminReceiver.isDeviceOwner(this)) {
            SchoolSetupHome.makePreferred(this)
            CheckInWorker.enroll(this, token)
            Provisioning.finishSystemSetup(this); setup.clear(); finish()
        } else {
            val reason = Provisioning.unavailableReason(this)
            if (reason != null) throw IllegalStateException(reason)
            Provisioning.request(this, token)
        }
    }

    private fun completeManagedSetup(source: Intent?) {
        if (completingManagement || !AdminReceiver.isDeviceOwner(this) || AgentStore(this).isEnrolled) return
        val token = source?.getStringExtra("token")?.trim()?.takeIf { it.isNotEmpty() } ?: setup.enrollmentKey ?: Provisioning.pendingToken(this) ?: return
        completingManagement = true
        launch("Activating PrimeSecure and applying the school workspace...") { enrollAndPrepare(token) }
    }

    private fun launch(message: String, block: suspend () -> Unit) {
        if (busy) return; busy = true; showWorking(message)
        scope.launch {
            try { block() }
            catch (e: Exception) {
                render(); AlertDialog.Builder(this@DeviceSetupActivity).setTitle("Setup needs attention").setMessage(Connectivity.message(e)).setPositiveButton("OK", null).show()
            } finally { busy = false }
        }
    }

    private fun showWorking(message: String) {
        val content = FirstBootUi.centered(this, 700).apply {
            addView(ProgressBar(this@DeviceSetupActivity), LinearLayout.LayoutParams(dp(64), dp(64)).apply { gravity = Gravity.CENTER_HORIZONTAL })
            addView(FirstBootUi.space(this@DeviceSetupActivity, 18)); addView(FirstBootUi.title(this@DeviceSetupActivity, message, 25f))
            addView(FirstBootUi.subtitle(this@DeviceSetupActivity, "Keep your PrimeBook on and connected.", 15f))
        }
        setContentView(FirstBootUi.screen(this, content))
    }

    private fun resetVerification() { setup.sessionId = null; setup.assignmentState = null; setup.studentName = null; setup.schoolName = null; setup.assignmentDate = null; render() }
    private fun openPreparation() { startActivity(InitialSetup(this).destination()); finish() }
    private fun formattedDate(value: String?): String = runCatching {
        DateTimeFormatter.ofPattern("d MMMM yyyy").format(Instant.parse(value).atZone(ZoneId.systemDefault()))
    }.getOrElse { value?.take(10) ?: "Recorded by the school" }
    private fun classLabel(): String = setup.classForm?.let { form ->
        "Form $form${setup.classSection?.let { " $it" }.orEmpty()}"
    } ?: "Recorded by the school"
    private fun toast(value: String) = Toast.makeText(this, value, Toast.LENGTH_LONG).show()
    private fun dp(value: Int) = FirstBootUi.dp(this, value)
}
