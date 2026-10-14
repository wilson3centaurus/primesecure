"use server";
import { canManage,getCurrentSchool,requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/types";
export async function saveManagementSettings(_prev:FormState,form:FormData):Promise<FormState> {
 const staff=await requireStaff(),school=await getCurrentSchool();if(!school||!canManage(staff,school.id))return {error:'School administrator access required.'};
 const db=await createClient();const viewers:Record<string,string>={};
 for(const kind of ['books','videos','images','music']) {
  const pkg=String(form.get(`viewer_${kind}`)||'');if(!pkg)continue;
  const {data}=await db.from('hub_items').select('id,school_id').eq('kind','app').eq('package_name',pkg).eq('published',true).or(`school_id.is.null,school_id.eq.${school.id}`);
  const {data:access}=await db.from('hub_access').select('item_id').eq('school_id',school.id);
  if(!data?.some(i=>i.school_id===school.id||access?.some(a=>a.item_id===i.id)))return {error:'Choose a published app enabled for this school.'};
  viewers[kind]=pkg;
 }
 const contacts=[0,1].map(n=>({name:String(form.get(`contact_name_${n}`)||'').trim(),phone:String(form.get(`contact_phone_${n}`)||'').trim()}));
 if(contacts.some(c=>!c.name||c.name.length>100||!c.phone||c.phone.length>40))return {error:'Enter each support contact’s name and phone.'};
 const {error}=await db.from('hub_settings').upsert({scope:school.id,school_id:school.id,block_usb_storage:form.get('block_usb_storage')==='on',block_usb_transfer:form.get('block_usb_transfer')==='on',keep_wifi_on:form.get('keep_wifi_on')==='on',hide_file_managers:form.get('hide_file_managers')==='on',viewer_packages:viewers,support_contacts:contacts});
 if(error)return {error:error.message};revalidatePath('/settings');return {ok:'Saved. Primebooks apply these settings at their next check-in.'};
}
export async function saveSchoolClass(_prev:FormState,form:FormData):Promise<FormState> {
 const staff=await requireStaff(),school=await getCurrentSchool();if(!school||!canManage(staff,school.id))return {error:'School administrator access required.'};
 const level=String(form.get('new_form')||form.get('existing_form')||'').trim(),klass=String(form.get('class_name')||'').trim();
 if(!level||level.length>80||klass.length>80)return {error:'Enter a form name, up to 80 characters.'};
 const db=await createClient();const {error}=await db.from('school_classes').upsert({school_id:school.id,form_level:level,class_name:klass},{onConflict:'school_id,form_level,class_name'});
 if(error)return {error:error.message};revalidatePath('/settings');revalidatePath('/devices','layout');revalidatePath('/library');return {ok:'Added. This form and class are available in dropdown menus.'};
}
