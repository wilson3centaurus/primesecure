"use server";
import { canManage,getCurrentSchool,requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/types";
import { BUILTIN_APP_REQUESTS } from "@/lib/school-controls";
export async function saveManagementSettings(_prev:FormState,form:FormData):Promise<FormState> {
 const staff=await requireStaff(),school=await getCurrentSchool();if(!school||!canManage(staff,school.id))return {error:'School administrator access required.'};
 const db=await createClient();
 const section=String(form.get("section")||"device");
 if(section!=="device" && section!=="viewers")return {error:"Invalid settings section."};
 const viewers:Record<string,string>={};
 if(section==="viewers") {
 for(const kind of ['books','documents','videos','images','music']) {
  const pkg=String(form.get(`viewer_${kind}`)||'');if(!pkg)continue;
  const {data}=await db.from('hub_items').select('id,school_id').eq('kind','app').eq('package_name',pkg).eq('published',true).or(`school_id.is.null,school_id.eq.${school.id}`);
  const {data:access}=await db.from('hub_access').select('item_id').eq('school_id',school.id);
  if(!data?.some(i=>i.school_id===school.id||access?.some(a=>a.item_id===i.id)))return {error:'Choose a published app enabled for this school.'};
  viewers[kind]=pkg;
 }
 const {error}=await db.from('hub_settings').upsert({scope:school.id,school_id:school.id,viewer_packages:viewers});
 if(error)return {error:error.message};revalidatePath('/apps');return {ok:'Saved. A sync request is queued for connected Primebooks. See School sync on each device.'};
 }
 const contacts=[0,1].map(n=>({name:String(form.get(`contact_name_${n}`)||'').trim(),phone:String(form.get(`contact_phone_${n}`)||'').trim()}));
 if(contacts.some(c=>!c.name||c.name.length>100||!c.phone||c.phone.length>40))return {error:'Enter each support contact’s name and phone.'};
 const interval=Number(form.get('location_interval_minutes')||30);if(![5,15,30,60,120,1440].includes(interval))return {error:'Choose a location update interval.'};
 const controls=Object.fromEntries(['block_bluetooth_transfer','block_bluetooth','block_add_users','block_user_switch','block_factory_reset','usage_reporting'].map(key=>[key,form.get(key)==='on']));
 const {error}=await db.from('hub_settings').upsert({scope:school.id,school_id:school.id,block_usb_storage:form.get('block_usb_storage')==='on',block_usb_transfer:form.get('block_usb_transfer')==='on',keep_wifi_on:form.get('keep_wifi_on')==='on',hide_file_managers:form.get('hide_file_managers')==='on',support_contacts:contacts,...controls,location_interval_minutes:interval});
 if(error)return {error:error.message};revalidatePath('/settings');return {ok:'Saved. A sync request is queued for connected Primebooks. Offline devices catch up after reconnecting.'};
}
export async function saveSchoolClass(_prev:FormState,form:FormData):Promise<FormState> {
 const staff=await requireStaff(),school=await getCurrentSchool();if(!school||!canManage(staff,school.id))return {error:'School administrator access required.'};
 const level=String(form.get('new_form')||form.get('existing_form')||'').trim(),klass=String(form.get('class_name')||'').trim();
 if(!level||level.length>80||klass.length>80)return {error:'Enter a form name, up to 80 characters.'};
 const db=await createClient();const {error}=await db.from('school_classes').upsert({school_id:school.id,form_level:level,class_name:klass},{onConflict:'school_id,form_level,class_name'});
 if(error)return {error:error.message};revalidatePath('/settings');revalidatePath('/devices','layout');revalidatePath('/library');return {ok:'Added. This form and class are available in dropdown menus.'};
}

export async function deleteSchoolGroup(_prev:FormState,form:FormData):Promise<FormState> {
 const staff=await requireStaff(),school=await getCurrentSchool();
 if(!school||!canManage(staff,school.id))return {error:'School administrator access required.'};
 const level=String(form.get('form_level')||'').trim();
 const klass=form.has('class_name')?String(form.get('class_name')||''):null;
 if(!level||level.length>80||(klass!==null&&klass.length>80))return {error:'Choose a valid form or class.'};
 const db=await createClient();const {error}=await db.rpc('staff_delete_school_group',{p_school_id:school.id,p_form:level,p_class:klass});
 if(error)return {error:error.message};
 for(const path of ['/settings','/devices','/library','/messages'])revalidatePath(path);
 return {ok:klass===null?'Form deleted. Existing learning resources were kept.':'Class deleted.'};
}

export async function saveAppRules(_prev:FormState,form:FormData):Promise<FormState> {
 const staff=await requireStaff(),school=await getCurrentSchool();if(!school||!canManage(staff,school.id))return {error:'School administrator access required.'};
 const requested=form.getAll('blocked_package').map(String);if(requested.some(pkg=>!BUILTIN_APP_REQUESTS.some(a=>a.package===pkg)))return {error:'Invalid app control request.'};
 const db=await createClient();const {error}=await db.from('hub_settings').upsert({scope:school.id,school_id:school.id,approved_apps_only:form.get('approved_apps_only')==='on',blocked_packages:requested});
 if(error)return {error:error.message};revalidatePath('/apps');return {ok:'Saved. A sync request is queued. Check School sync on each device for confirmation.'};
}
