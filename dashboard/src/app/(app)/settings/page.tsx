import { canManage,getCurrentSchool,requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ManagementSettings } from "@/components/management-settings";
import { SchoolClassSettings } from "@/components/school-class-settings";
import { SectionTabs } from "@/components/section-tabs";
import { PolicyEditor } from "@/components/policy-editor";
import { HubLibrary } from "@/components/hub-library";
import { FactoryContentExports } from "@/components/factory-content-exports";
import { getPolicy } from "@/lib/policy";
import { setFleetLicenceValidation } from "./actions";
export default async function Settings({searchParams}:{searchParams:Promise<{tab?:string;licence_notice?:string;licence_error?:string}>}) {
 const staff=await requireStaff(),school=await getCurrentSchool();if(!school)return <p>Select a school first.</p>;if(!canManage(staff,school.id))redirect('/overview');
 const params=await searchParams;const {tab="device"}=params;const tabs=[{id:"device",label:"Device & support"},{id:"classes",label:"Forms & classes"},{id:"web",label:"Web filtering"},{id:"appearance",label:"Wallpaper defaults"}];const current=tabs.some(t=>t.id===tab)?tab:"device";
 const db=await createClient();const [{data:settings},{data:groups},policy,licence]=await Promise.all([db.from('hub_settings').select('*').eq('scope',school.id).maybeSingle(),db.from('school_classes').select('id,form_level,class_name').eq('school_id',school.id).order('form_level').order('class_name'),getPolicy(school.id,null),staff.role==='super_admin'?db.rpc('staff_licence_configuration'):Promise.resolve({data:null,error:null})]);
 return <><PageHeader title="Settings" description={school.name}/><SectionTabs base="/settings" current={current} tabs={tabs}/>{current==="device"?<>{params.licence_notice&&<p role="status" className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{params.licence_notice}</p>}{params.licence_error&&<p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{params.licence_error}</p>}{staff.role==='super_admin'&&<section className="card mb-5 max-w-4xl p-5"><h2 className="text-sm font-semibold">Fleet licence validation</h2><p className="mt-2 text-sm text-slate-500">Keep this off while validating PrimeOS and student-management policies. Individual licence states remain saved, but every device is treated as good until validation is enabled.</p><div className="mt-4 flex items-center gap-3"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${licence.data?.validation_enabled?'bg-emerald-100 text-emerald-800':'bg-amber-100 text-amber-900'}`}>{licence.data?.validation_enabled?'Enabled':'Disabled'}</span><form action={setFleetLicenceValidation}><input type="hidden" name="enabled" value={licence.data?.validation_enabled?'false':'true'}/><button className={licence.data?.validation_enabled?'btn-secondary':'btn-primary'}>{licence.data?.validation_enabled?'Disable validation':'Enable validation'}</button></form></div></section>}<FactoryContentExports/><ManagementSettings settings={settings||{}} apps={[]}/></>:current==="classes"?<SchoolClassSettings groups={groups||[]}/>:current==="appearance"?<HubLibrary kind="wallpaper" settingsOnly/>:<PolicyEditor key={school.id} policy={policy} schoolId={school.id} canEdit mode="web"/>}</>;
}
