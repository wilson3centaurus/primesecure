"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/types";

export type AddDevicesState = (NonNullable<FormState> & { created?: { id: string; name: string; token: string }[] }) | undefined;

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
      const [name, id] = line.split(",").map((p) => p.trim());
      return { school_id: school.id, student_name: name || null, student_id: id || null };
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
