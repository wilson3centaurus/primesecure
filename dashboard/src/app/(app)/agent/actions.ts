"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/types";

async function superAdmin() {
  const staff = await requireStaff();
  return staff.role === "super_admin" ? createClient() : null;
}

export async function addRelease(input: {
  versionCode: number; versionName: string; storagePath: string; sha256: string; notes: string;
}): Promise<FormState> {
  const supabase = await superAdmin();
  if (!supabase) return { error: "Only RoboKorda admins publish agent updates." };
  if (!Number.isInteger(input.versionCode) || input.versionCode <= 0) return { error: "Enter the version code." };
  if (!input.versionName.trim()) return { error: "Enter the version name." };
  if (!input.storagePath.startsWith("releases/")) return { error: "Upload the APK again." };

  const { error } = await supabase.from("agent_releases").insert({
    version_code: input.versionCode,
    version_name: input.versionName.trim(),
    storage_path: input.storagePath,
    sha256: input.sha256 || null,
    notes: input.notes.trim() || null,
  });
  if (error) {
    await supabase.storage.from("agent").remove([input.storagePath]);
    return { error: error.code === "23505" ? "That version code is already published." : error.message };
  }
  revalidatePath("/agent");
  return { ok: `Published ${input.versionName} (${input.versionCode}). Devices update at their next check-in.` };
}

export async function setReleaseActive(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await superAdmin();
  if (!supabase) return { error: "Not allowed." };
  const { error } = await supabase
    .from("agent_releases")
    .update({ active: formData.get("active") === "true" })
    .eq("id", String(formData.get("id") ?? ""));
  if (error) return { error: error.message };
  revalidatePath("/agent");
  return { ok: "Saved." };
}

export async function deleteRelease(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await superAdmin();
  if (!supabase) return { error: "Not allowed." };
  const id = String(formData.get("id") ?? "");
  const { data: release } = await supabase.from("agent_releases").select("storage_path").eq("id", id).maybeSingle();
  if (!release) return { error: "Not found." };
  await supabase.storage.from("agent").remove([release.storage_path]);
  const { error } = await supabase.from("agent_releases").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/agent");
  return { ok: "Deleted." };
}
