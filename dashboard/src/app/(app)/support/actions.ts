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
 const {error}=await db.rpc('staff_support_reply',{p_device_id:id,p_body:body});
 if(error)return {error:error.message};revalidatePath('/support');return {ok:'Reply sent. It appears on the Primebook when it next syncs.'};
}
