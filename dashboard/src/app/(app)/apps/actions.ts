"use server";

import { revalidatePath } from "next/cache";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/types";

const PACKAGE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;

export async function addApp(input: { name: string; storagePath: string; size: number }): Promise<FormState> {
  const staff = await requireStaff();
  const school = await getCurrentSchool();
  if (!school || !canManage(staff, school.id)) return { error: "Only school admins can add apps." };
  const name = input.name.trim();
  if (!name) return { error: "Name the app." };
  if (!input.storagePath.startsWith(`${school.id}/`)) return { error: "Upload the APK again." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("apps")
    .insert({ school_id: school.id, name, storage_path: input.storagePath, size: input.size });
  if (error) return { error: error.message };
  revalidatePath("/apps");
  return { ok: `Added ${name}.` };
}

export async function deleteApp(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const { data: app } = await supabase.from("apps").select("id, school_id, storage_path").eq("id", id).maybeSingle();
  if (!app || !canManage(staff, app.school_id)) return { error: "You can't delete this app." };

  await supabase.storage.from("apks").remove([app.storage_path]);
  const { error } = await supabase.from("apps").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/apps");
  return { ok: "Deleted. Devices keep the app; remove it from them separately." };
}

// target: a device id, or "school" for every enrolled device in the app's school.
export async function installApp(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const supabase = await createClient();
  const appId = String(formData.get("app_id") ?? "");
  const target = String(formData.get("target") ?? "");
  const { data: app } = await supabase.from("apps").select("id, school_id, name, storage_path").eq("id", appId).maybeSingle();
  if (!app || !canManage(staff, app.school_id)) return { error: "Pick an app from the library." };

  const query = supabase.from("devices").select("id").eq("school_id", app.school_id).in("status", ["active", "suspended", "locked"]);
  const { data: devices } = await (target === "school" ? query : query.eq("id", target));
  const ids = (devices ?? []).map((d) => d.id);
  if (ids.length === 0) return { error: "No enrolled devices to install on." };

  const payload = { app_id: app.id, name: app.name, storage_path: app.storage_path };
  const { error } = await supabase
    .from("commands")
    .insert(ids.map((device_id) => ({ device_id, type: "install_apk", payload, created_by: staff.id })));
  if (error) return { error: error.message };
  revalidatePath("/devices", "layout");
  return { ok: ids.length === 1 ? `Installing ${app.name}.` : `Installing ${app.name} on ${ids.length} devices.` };
}

export async function removeApp(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const deviceId = String(formData.get("device_id") ?? "");
  const pkg = String(formData.get("package") ?? "").trim();
  if (!PACKAGE.test(pkg)) return { error: "Not a valid package name." };
  if (pkg === "com.robokorda.primesecure") return { error: "PrimeSecure can't remove itself." };

  const supabase = await createClient();
  const { data: device } = await supabase.from("devices").select("id, school_id").eq("id", deviceId).maybeSingle();
  if (!device || !canManage(staff, device.school_id)) return { error: "Only school admins can remove apps." };

  const { error } = await supabase
    .from("commands")
    .insert({ device_id: device.id, type: "remove_apk", payload: { package: pkg }, created_by: staff.id });
  if (error) return { error: error.message };
  revalidatePath(`/devices/${device.id}`);
  return { ok: `Removing ${pkg}.` };
}
