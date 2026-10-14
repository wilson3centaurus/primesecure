import { canManage,getCurrentSchool,requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ManagementSettings } from "@/components/management-settings";
import { SchoolClassSettings } from "@/components/school-class-settings";
export default async function Settings() {
 const staff=await requireStaff(),school=await getCurrentSchool();if(!school)return <p>Select a school first.</p>;if(!canManage(staff,school.id))redirect('/overview');
 const db=await createClient();const [{data:settings},{data:apps},{data:access}]=await Promise.all([
  db.from('hub_settings').select('*').eq('scope',school.id).maybeSingle(),
  db.from('hub_items').select('id,title,package_name,school_id').eq('kind','app').eq('published',true).or(`school_id.is.null,school_id.eq.${school.id}`),
  db.from('hub_access').select('item_id').eq('school_id',school.id)
 ]);
 const {data:groups}=await db.from('school_classes').select('id,form_level,class_name').eq('school_id',school.id).order('form_level').order('class_name');
 return <><PageHeader title="Workspace settings" description={`Controls, media viewers and support for ${school.name}.`}/><SchoolClassSettings groups={groups||[]}/><ManagementSettings settings={settings||{}} apps={(apps||[]).filter(a=>a.school_id||(access||[]).some(x=>x.item_id===a.id))}/></>;
}
