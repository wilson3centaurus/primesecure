"use server";

import { revalidatePath } from "next/cache";
import { canManage, requireStaff } from "@/lib/auth";
import { SUPABASE_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/types";

const PACKAGE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;

function packages(raw: FormDataEntryValue | null): string[] | string {
  const list = [...new Set(String(raw ?? "").split(/[\s,]+/).map((p) => p.trim()).filter(Boolean))];
  const bad = list.find((p) => !PACKAGE.test(p));
  return bad ? `"${bad}" is not a valid package name (like com.android.chrome).` : list;
}

// Resolves which policy row a form targets and whether the caller may edit it.
async function target(formData: FormData) {
  const staff = await requireStaff();
  const supabase = await createClient();
  const deviceId = String(formData.get("device_id") ?? "") || null;
  let schoolId = String(formData.get("school_id") ?? "");

  if (deviceId) {
    const { data: device } = await supabase.from("devices").select("school_id").eq("id", deviceId).maybeSingle();
    if (!device) return null;
    schoolId = device.school_id;
  }
  if (!schoolId || !canManage(staff, schoolId)) return null;

  const query = supabase.from("policies").select("id").eq("school_id", schoolId);
  const { data: existing } = await (deviceId ? query.eq("device_id", deviceId) : query.is("device_id", null)).maybeSingle();
  return { supabase, schoolId, deviceId, existingId: existing?.id as string | undefined };
}

function revalidate(deviceId: string | null) {
  revalidatePath("/policy");
  if (deviceId) revalidatePath(`/devices/${deviceId}`, "layout");
}

export async function savePolicy(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await target(formData);
  if (!t) return { error: "Only school admins can change policies." };

  const hidden = packages(formData.get("hidden_apps"));
  if (typeof hidden === "string") return { error: hidden };
  const allowed = packages(formData.get("allowed_apps"));
  if (typeof allowed === "string") return { error: allowed };

  // Only accept wallpapers from this school's folder in our own public bucket.
  const wallpaper = String(formData.get("wallpaper_url") ?? "").trim() || null;
  const prefix = `${SUPABASE_URL}/storage/v1/object/public/wallpapers/${t.schoolId}/`;
  if (wallpaper && !wallpaper.startsWith(prefix)) return { error: "Upload the wallpaper again." };

  const row = {
    wallpaper_url: wallpaper,
    lock_wallpaper: formData.get("lock_wallpaper") === "on",
    block_installs: formData.get("block_installs") === "on",
    hide_settings: formData.get("hide_settings") === "on",
    hidden_apps: hidden,
    allowed_apps: allowed,
  };

  const { error } = t.existingId
    ? await t.supabase.from("policies").update(row).eq("id", t.existingId)
    : await t.supabase.from("policies").insert({ ...row, school_id: t.schoolId, device_id: t.deviceId });
  if (error) return { error: error.message };

  revalidate(t.deviceId);
  return { ok: "Saved. Devices apply it at their next check-in (within 15 minutes)." };
}

export async function removePolicy(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await target(formData);
  if (!t) return { error: "Only school admins can change policies." };
  if (t.existingId) {
    const { error } = await t.supabase.from("policies").delete().eq("id", t.existingId);
    if (error) return { error: error.message };
  }
  revalidate(t.deviceId);
  return { ok: t.deviceId ? "This device now follows the school policy." : "School policy removed. Devices without their own policy are unrestricted." };
}
