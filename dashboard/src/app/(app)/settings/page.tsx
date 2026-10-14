import { canManage,getCurrentSchool,requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ManagementSettings } from "@/components/management-settings";
import { SchoolClassSettings } from "@/components/school-class-settings";
import { SectionTabs } from "@/components/section-tabs";
import { PolicyEditor } from "@/components/policy-editor";
import { HubLibrary } from "@/components/hub-library";
import { getPolicy } from "@/lib/policy";
export default async function Settings({searchParams}:{searchParams:Promise<{tab?:string}>}) {
 const staff=await requireStaff(),school=await getCurrentSchool();if(!school)return <p>Select a school first.</p>;if(!canManage(staff,school.id))redirect('/overview');
 const {tab="device"}=await searchParams;const tabs=[{id:"device",label:"Device & support"},{id:"classes",label:"Forms & classes"},{id:"web",label:"Web filtering"},{id:"appearance",label:"Wallpaper defaults"}];const current=tabs.some(t=>t.id===tab)?tab:"device";
 const db=await createClient();const [{data:settings},{data:groups},policy]=await Promise.all([db.from('hub_settings').select('*').eq('scope',school.id).maybeSingle(),db.from('school_classes').select('id,form_level,class_name').eq('school_id',school.id).order('form_level').order('class_name'),getPolicy(school.id,null)]);
 return <><PageHeader title="Settings" description={school.name}/><SectionTabs base="/settings" current={current} tabs={tabs}/>{current==="device"?<ManagementSettings settings={settings||{}} apps={[]}/>:current==="classes"?<SchoolClassSettings groups={groups||[]}/>:current==="appearance"?<HubLibrary kind="wallpaper" settingsOnly/>:<PolicyEditor key={policy?.id||"new"} policy={policy} schoolId={school.id} canEdit mode="web"/>}</>;
}
