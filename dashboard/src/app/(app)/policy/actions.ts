"use server";

import { revalidatePath } from "next/cache";
import { canManage, requireStaff } from "@/lib/auth";
import { SUPABASE_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/types";

const PACKAGE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;
const SITE = /^(\*|(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*)$/;

// One site per line; "https://www.example.com/path" is reduced to "www.example.com".
function sites(raw: FormDataEntryValue | null): string[] | string {
  const list = [...new Set(String(raw ?? "").split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split("/")[0].split(":")[0])
    .filter(Boolean))];
  const bad = list.find((s) => !SITE.test(s));
  return bad ? `"${bad}" is not a website (like tiktok.com).` : list;
}

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

  const blocklist = sites(formData.get("web_blocklist"));
  if (typeof blocklist === "string") return { error: blocklist };
  const allowlist = sites(formData.get("web_allowlist"));
  if (typeof allowlist === "string") return { error: allowlist };
  const webFilter = String(formData.get("web_filter") ?? "off");
  if (!["off", "blocklist", "allowlist"].includes(webFilter)) return { error: "Pick a web filter mode." };
  if (webFilter === "allowlist" && allowlist.length === 0) return { error: "Add at least one allowed website." };
  const home = String(formData.get("browser_home_url") ?? "").trim() || null;
  if (home && !/^https?:\/\/\S+$/.test(home)) return { error: "Home page must start with http:// or https://" };

  const row = {
    wallpaper_url: wallpaper,
    lock_wallpaper: formData.get("lock_wallpaper") === "on",
    block_installs: formData.get("block_installs") === "on",
    hide_settings: formData.get("hide_settings") === "on",
    hidden_apps: hidden,
    allowed_apps: allowed,
    web_filter: webFilter,
    web_blocklist: blocklist,
    web_allowlist: allowlist,
    safe_search: formData.get("safe_search") === "on",
    browser_home_url: home,
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
