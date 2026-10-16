"use server";
import { requireStaff,canManage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/types";
export async function supportReply(_prev:FormState,form:FormData):Promise<FormState> {
 const staff=await requireStaff(),db=await createClient(),id=String(form.get('device_id')||''),body=String(form.get('body')||'').trim();
 const {data:d}=await db.from('devices').select('school_id').eq('id',id).maybeSingle();
 if(!d||!canManage(staff,d.school_id))return {error:'School administrator access required.'};
 if(!body||body.length>4000)return {error:'Enter a message, up to 4,000 characters.'};
 const image=String(form.get('image')||'');
 if(image.length>100000||(image&&!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image)))return {error:'Choose a smaller JPEG image.'};
 const {error}=await db.rpc('staff_support_post',{p_device_id:id,p_body:body,p_image:image||null});
 if(error)return {error:error.message};revalidatePath('/support');return {ok:'Reply sent. It appears on the Primebook when it next syncs.'};
}
export async function deleteSupportMessage(_prev:FormState,form:FormData):Promise<FormState> {
 await requireStaff();const db=await createClient();const {error}=await db.rpc('support_delete_message',{p_id:String(form.get('id')||'')});
 if(error)return {error:error.message};revalidatePath('/support');return {ok:'Message deleted. Student copies update after sync.'};
}
export async function updateBugStatus(_prev:FormState,form:FormData):Promise<FormState> {
 await requireStaff();const db=await createClient();const {error}=await db.rpc('staff_bug_status',{p_id:String(form.get('id')||''),p_status:String(form.get('status')||'')});
 if(error)return {error:error.message};revalidatePath('/support');return {ok:'Report updated.'};
}
