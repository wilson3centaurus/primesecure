"use server";
import {revalidatePath} from "next/cache";
import {requireStaff,getCurrentSchool,canManage} from "@/lib/auth";
import {createClient} from "@/lib/supabase/server";
import type {FormState} from "@/lib/types";
export async function setAppDefault(_prev:FormState,form:FormData):Promise<FormState>{
 const staff=await requireStaff(),school=await getCurrentSchool();if(!school||!canManage(staff,school.id))return {error:'School administrator access required.'};
 const id=String(form.get('id')||''),value=form.get('preinstall');if(!/^[0-9a-f-]{36}$/i.test(id)||!['true','false'].includes(String(value)))return {error:'Choose an app and its install setting.'};
 const db=await createClient(),{error}=await db.rpc('staff_app_default',{p_school:school.id,p_item:id,p_preinstall:value==='true'});if(error)return {error:error.message};
 revalidatePath('/apps');return {ok:value==='true'?'Default install saved for this school. Online devices sync and install it; offline devices catch up later.':'Optional for this school. Existing installations are kept.'};
}
