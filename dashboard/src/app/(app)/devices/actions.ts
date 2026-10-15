"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/types";

export type AddDevicesState = (NonNullable<FormState> & { created?: { id: string; name: string; token: string }[] }) | undefined;

export async function requestDeviceSync(_previous:FormState,form:FormData):Promise<FormState> {
  await requireStaff();
  const device=String(form.get('device_id')||'');
  if(!/^[0-9a-f-]{36}$/i.test(device))return {error:'Invalid device.'};
  const db=await createClient();
  const {error}=await db.rpc('staff_request_device_sync',{p_device:device});
  if(error)return {error:error.message};
  revalidatePath(`/devices/${device}`);
  return {ok:'Sync requested. Connected agents receive a signal; offline devices catch up after reconnecting.'};
}

// One device per line: "Student name" or "Student name, student ID".
export async function addDevices(_prev: AddDevicesState, formData: FormData): Promise<AddDevicesState> {
  const staff = await requireStaff();
  const school = await getCurrentSchool();
  if (!school || !canManage(staff, school.id)) return { error: "Only school admins can add devices." };

  const rows = String(formData.get("students") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, form, klass, gender] = line.split(",").map((p) => p.trim());
      return { school_id: school.id, student_name: name.slice(0,160) || null, form_level:(form || String(formData.get('form_level')||'')).slice(0,80), class_name:(klass || String(formData.get('class_name')||'')).slice(0,80), gender:(gender || String(formData.get('gender')||'')).slice(0,40) };
    });
  if (rows.length === 0) return { error: "Enter at least one student name." };
  if (rows.length > 200) return { error: "Add at most 200 devices at a time." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("devices").insert(rows).select("id, student_name, enroll_token");
  if (error) return { error: error.message };

  revalidatePath("/devices");
  return {
    ok: `Added ${data.length} device${data.length === 1 ? "" : "s"}. Enroll each Primebook with its token within 7 days.`,
    created: data.map((d) => ({ id: d.id, name: d.student_name ?? "", token: d.enroll_token ?? "" })),
  };
}

async function deviceForManager(id: string) {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: device } = await supabase.from("devices").select("id, school_id, auth_user_id").eq("id", id).maybeSingle();
  if (!device || !canManage(staff, device.school_id)) return null;
  return { supabase, device };
}

export async function updateStudent(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  const ctx = await deviceForManager(id);
  if (!ctx) return { error: "You can't edit this device." };

  const { error } = await ctx.supabase
    .from("devices")
    .update({
      student_name: String(formData.get("student_name") ?? "").trim() || null,
      student_id: String(formData.get("student_id") ?? "").trim() || null,
      form_level:String(formData.get('form_level')||'').trim().slice(0,80),
      class_name:String(formData.get('class_name')||'').trim().slice(0,80),
      gender:String(formData.get('gender')||'').trim().slice(0,40),
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/devices/${id}`);
  return { ok: "Saved." };
}

export async function issueToken(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  const ctx = await deviceForManager(id);
  if (!ctx) return { error: "You can't re-enroll this device." };

  const { data: token, error: tokenError } = await ctx.supabase.rpc("gen_enroll_token");
  if (tokenError || !token) return { error: tokenError?.message ?? "Could not generate a token." };

  const { error } = await ctx.supabase
    .from("devices")
    .update({ enroll_token: token, enroll_token_expires_at: new Date(Date.now() + 7 * 86400_000).toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/devices/${id}`);
  return { ok: "New token issued. The old one no longer works." };
}

export async function deleteDevice(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  const ctx = await deviceForManager(id);
  if (!ctx) return { error: "You can't delete this device." };

  const { error } = await ctx.supabase.from("devices").delete().eq("id", id);
  if (error) return { error: error.message };
  // The device's own login would otherwise outlive it.
  if (ctx.device.auth_user_id) await createAdminClient().auth.admin.deleteUser(ctx.device.auth_user_id);
  revalidatePath("/devices");
  redirect("/devices");
}

const SETTABLE = ["active", "suspended", "locked", "retired"] as const;
export async function resetDevicePassword(_prev:FormState,form:FormData):Promise<FormState> {
 const staff=await requireStaff(),id=String(form.get('device_id')||'');const ctx=await deviceForManager(id);
 if(!ctx)return {error:'School administrator access required.'};
 const password=String(form.get('password')||'');if(password.length<6||password.length>64||password!==String(form.get('confirmation')||''))return {error:'Enter matching passwords of 6 to 64 characters.'};
 const {data:runtime}=await ctx.supabase.from('device_runtime').select('readings,reported_at').eq('device_id',id).maybeSingle();
 if(runtime?.readings?.recovery!=='ready'||Date.now()-Date.parse(runtime.reported_at)>86400000)return {error:'Recovery must be active and recently reported by this Primebook. Ask it to check in first.'};
 const {data:pending}=await ctx.supabase.from('commands').select('id').eq('device_id',id).eq('type','reset_password').in('status',['pending','delivered']);
 if(pending?.length)return {error:'A password reset is already waiting for this device.'};
 const {error}=await ctx.supabase.from('commands').insert({device_id:id,type:'reset_password',payload:{password,expires_at:new Date(Date.now()+30*60000).toISOString()},created_by:staff.id});
 if(error)return {error:error.message};revalidatePath(`/devices/${id}`);return {ok:'Reset queued for 30 minutes. Tell the student the temporary password after the command succeeds. It is removed from the command when acknowledged.'};
}

export async function setDeviceStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as (typeof SETTABLE)[number];
  if (!SETTABLE.includes(status)) return { error: "Unknown state." };
  const ctx = await deviceForManager(id);
  if (!ctx) return { error: "Only school admins can change this." };

  const { data: current } = await ctx.supabase.from("devices").select("status").eq("id", id).single();
  if (current?.status === "retired") return { error: "This device is retired. Re-provision it to use it again." };
  if (current?.status === "pending") return { error: "Enroll the device first." };

  const message = String(formData.get("status_message") ?? "").trim().slice(0, 500) || null;
  const { error } = await ctx.supabase
    .from("devices")
    .update({ status, status_message: status === "locked" ? message : null })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/devices/${id}`);
  revalidatePath("/devices");
  const done = { active: "Device is active again.", suspended: "Suspended.", locked: "Locked.", retired: "Retired." };
  return { ok: `${done[status]} Online devices react within seconds; others when they next connect.` };
}
