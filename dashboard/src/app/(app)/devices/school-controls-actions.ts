"use server";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/types";
export type LostState={error?:string;ok?:string;code?:string}|undefined;
export async function setLost(_previous:LostState,form:FormData):Promise<LostState> {
 await requireStaff();const id=String(form.get('device_id')||'');
 if(form.get('confirm')!=='on')return {error:'Confirm the recovery action for this school-owned device.'};
 const db=await createClient();
 const {data,error}=await db.rpc('staff_set_lost',{p_device:id,p_lost:form.get('mode')==='lost',p_alarm:form.get('alarm')==='on',p_message:String(form.get('message')||'').slice(0,1000)});
 if(error)return {error:error.message};revalidatePath(`/devices/${id}`);revalidatePath('/devices');
 return {ok:form.get('mode')==='lost'?'Lost mode queued. Online delivery and PrimeOS lock/alarm enforcement must be checked.':'Found: unlock and alarm-stop request queued.',code:data?.recovery_code||undefined};
}
export async function setPrimeId(_previous:FormState,form:FormData):Promise<FormState> {
 await requireStaff();const id=String(form.get('device_id')||'');const db=await createClient();
 const {error}=await db.rpc('staff_set_prime_id',{p_device:id,p_prime_id:String(form.get('prime_id')||'')});
 if(error)return {error:error.message};revalidatePath(`/devices/${id}`);revalidatePath('/devices');return {ok:'Verified Prime ID saved. Student number remains separate.'};
}
