package com.robokorda.primesecure

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.*

/** Mandatory student-details rehearsal reached after the offline first-boot test. */
class MandatoryStudentSetupActivity : Activity() {
    private val regions=arrayOf("Harare","Bulawayo","Manicaland","Mashonaland Central","Mashonaland East","Mashonaland West","Masvingo","Matabeleland North","Matabeleland South","Midlands","Other")
    private val forms=(1..6).map{"Form $it"}
    private val sections=('A'..'Z').map(Char::toString)
    private val test by lazy{FirstBootTestStore(this)}
    override fun onCreate(state:Bundle?){super.onCreate(state);if(!BuildConfig.FIRST_BOOT_TEST_MODE){finish();return};renderForm()}
    @Deprecated("Mandatory setup cannot be skipped")override fun onBackPressed()=Unit

    private fun renderForm(){
        val content=FirstBootUi.centered(this,800).apply{
            addView(FirstBootUi.text(this@MandatoryStudentSetupActivity,"♙",52f,FirstBootUi.blue,true).apply{gravity=Gravity.CENTER})
            addView(FirstBootUi.title(this@MandatoryStudentSetupActivity,if(test.existing)"Welcome back, ${test.studentName}" else "Good day, ${test.studentName}",31f))
            addView(FirstBootUi.subtitle(this@MandatoryStudentSetupActivity,if(test.existing)"Anything you want to change?" else "Mandatory student setup is required.",17f))
            addView(FirstBootUi.space(this@MandatoryStudentSetupActivity,16))
            if(test.existing)addView(FirstBootUi.card(this@MandatoryStudentSetupActivity,18).apply{
                addView(detail("Student",test.studentName));addView(detail("School",test.school));addView(detail("Assigned",test.assignmentDate))
            },LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(FirstBootUi.space(this@MandatoryStudentSetupActivity,12))
            val phone=EditText(this@MandatoryStudentSetupActivity).apply{hint="Phone number, e.g. 077 123 4567";inputType=InputType.TYPE_CLASS_PHONE;setText(test.phone);setPadding(dp(14),dp(10),dp(14),dp(10));background=FirstBootUi.rounded(this@MandatoryStudentSetupActivity,Color.WHITE,12,FirstBootUi.line)}
            addView(FirstBootUi.text(this@MandatoryStudentSetupActivity,"STUDENT / GUARDIAN PHONE",11f,FirstBootUi.muted,true));addView(phone,LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,dp(58)))
            addView(FirstBootUi.space(this@MandatoryStudentSetupActivity,10))
            val region=Spinner(this@MandatoryStudentSetupActivity).apply{adapter=ArrayAdapter(this@MandatoryStudentSetupActivity,android.R.layout.simple_spinner_dropdown_item,regions);setSelection(regions.indexOf(test.region).coerceAtLeast(0));background=FirstBootUi.rounded(this@MandatoryStudentSetupActivity,Color.WHITE,12,FirstBootUi.line)}
            addView(FirstBootUi.text(this@MandatoryStudentSetupActivity,"REGION / PROVINCE",11f,FirstBootUi.muted,true));addView(region,LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,dp(58)))
            addView(FirstBootUi.space(this@MandatoryStudentSetupActivity,10))
            val classRow=LinearLayout(this@MandatoryStudentSetupActivity).apply{orientation=LinearLayout.HORIZONTAL}
            val form=Spinner(this@MandatoryStudentSetupActivity).apply{adapter=ArrayAdapter(this@MandatoryStudentSetupActivity,android.R.layout.simple_spinner_dropdown_item,forms);setSelection((test.classForm.toIntOrNull()?.minus(1)?:0).coerceIn(0,5));background=FirstBootUi.rounded(this@MandatoryStudentSetupActivity,Color.WHITE,12,FirstBootUi.line)}
            val section=Spinner(this@MandatoryStudentSetupActivity).apply{adapter=ArrayAdapter(this@MandatoryStudentSetupActivity,android.R.layout.simple_spinner_dropdown_item,sections);setSelection(sections.indexOf(test.classSection).coerceAtLeast(0));background=FirstBootUi.rounded(this@MandatoryStudentSetupActivity,Color.WHITE,12,FirstBootUi.line)}
            classRow.addView(form,LinearLayout.LayoutParams(0,dp(58),1f).apply{marginEnd=dp(8)});classRow.addView(section,LinearLayout.LayoutParams(0,dp(58),1f).apply{marginStart=dp(8)})
            addView(FirstBootUi.text(this@MandatoryStudentSetupActivity,"CLASS",11f,FirstBootUi.muted,true));addView(classRow,LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,dp(58)))
            addView(FirstBootUi.button(this@MandatoryStudentSetupActivity,"Save and open PrimeSecure  →"){
                val number=PhoneNumbers.zimbabwe(phone.text.toString());if(number==null){Toast.makeText(this@MandatoryStudentSetupActivity,"Enter a valid Zimbabwe phone number.",Toast.LENGTH_LONG).show();return@button}
                test.phone=number;test.region=region.selectedItem.toString();test.classForm=(form.selectedItemPosition+1).toString();test.classSection=section.selectedItem.toString();renderComplete()
            },LinearLayout.LayoutParams(dp(580),dp(54)).apply{gravity=Gravity.CENTER_HORIZONTAL})
        }
        setContentView(FirstBootUi.screen(this,content,scroll=true))
    }
    private fun renderComplete(){
        val content=FirstBootUi.centered(this,720).apply{
            addView(FirstBootUi.text(this@MandatoryStudentSetupActivity,"✓",64f,FirstBootUi.green,true).apply{gravity=Gravity.CENTER})
            addView(FirstBootUi.title(this@MandatoryStudentSetupActivity,"Welcome, ${test.studentName}",36f))
            addView(FirstBootUi.subtitle(this@MandatoryStudentSetupActivity,"Student setup is complete in this offline test preview.",17f))
            addView(FirstBootUi.space(this@MandatoryStudentSetupActivity,16))
            addView(FirstBootUi.card(this@MandatoryStudentSetupActivity).apply{addView(detail("School",test.school));addView(detail("Class","Form ${test.classForm} ${test.classSection}"));addView(detail("Region",test.region));addView(detail("Phone",test.phone))})
            addView(FirstBootUi.subtitle(this@MandatoryStudentSetupActivity,"No server account, policy or enrollment was created.",13f))
            addView(FirstBootUi.button(this@MandatoryStudentSetupActivity,"Run test again",true){
                DeviceSetupStore(this@MandatoryStudentSetupActivity).clear()
                startActivity(Intent(this@MandatoryStudentSetupActivity, DeviceSetupActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK))
                finish()
            },LinearLayout.LayoutParams(dp(500),dp(52)).apply{gravity=Gravity.CENTER_HORIZONTAL})
        }
        setContentView(FirstBootUi.screen(this,content))
    }
    private fun detail(label:String,value:String)=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL;setPadding(0,dp(5),0,dp(5));addView(FirstBootUi.text(this@MandatoryStudentSetupActivity,label,13f,FirstBootUi.muted),LinearLayout.LayoutParams(dp(160),ViewGroup.LayoutParams.WRAP_CONTENT));addView(FirstBootUi.text(this@MandatoryStudentSetupActivity,value,14f,FirstBootUi.navy,true),LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1f))}
    private fun dp(value:Int)=FirstBootUi.dp(this,value)
}
