"use server";

import { revalidatePath } from "next/cache";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/types";
import { inspectApk } from "@/lib/apk";

export async function publishItem(input: { kind: string; title: string; description: string; form: string; subject: string; category: string; path: string; mime: string; size: number; packageName?: string; shared: boolean; preinstall: boolean }): Promise<FormState> {
  const staff = await requireStaff();
  const school = await getCurrentSchool();
  if (!school || !canManage(staff, school.id) || (input.shared && staff.role !== "super_admin")) return { error: "Administrator access required." };
  const prefix = input.shared ? "shared" : school.id;
  if (!input.path.startsWith(`${prefix}/`) || input.path.includes("..") || !["resource", "wallpaper", "app"].includes(input.kind)) return { error: "Invalid upload." };
  if ((!input.title.trim() && input.kind!=="app") || input.title.length > 160 || input.description.length > 2000) return { error: "Enter a title of up to 160 characters and description of up to 2,000." };
  if (input.kind === "wallpaper" && !["image/jpeg", "image/png", "image/webp"].includes(input.mime)) return { error: "Wallpapers must be JPG, PNG or WebP." };
  const supabase = await createClient();
  const slash = input.path.lastIndexOf("/");
  const { data: files, error: fileError } = await supabase.storage.from("primesecure-hub").list(input.path.slice(0, slash), { search: input.path.slice(slash + 1) });
  const uploaded = files?.find(f => f.name === input.path.slice(slash + 1));
  if (fileError || !uploaded || Number(uploaded.metadata?.size) !== input.size) return { error: "Upload could not be verified. Please upload again." };
  let apk: Awaited<ReturnType<typeof inspectApk>> | undefined;
  if(input.kind==="app") {
    if(input.size>250_000_000)return {error:"Choose an APK smaller than 250 MB."};
    const {data:blob,error:downloadError}=await supabase.storage.from("primesecure-hub").download(input.path);
    if(downloadError || !blob)return {error:downloadError?.message||"Could not read APK."};
    try { apk=await inspectApk(Buffer.from(await blob.arrayBuffer()),input.path.slice(slash+1)); }
    catch(e){return {error:e instanceof Error?e.message:"Could not inspect APK."};}
  }
  const { error } = await supabase.from("hub_items").insert({
    school_id: input.shared ? null : school.id, kind: input.kind, title: (input.title.trim()||apk?.title||"App").slice(0,160), description: input.description,
    form_level: input.form.slice(0, 80), subject: input.subject.slice(0, 100), category: input.category.slice(0, 80),
    storage_path: input.path, mime_type: input.mime, size: input.size,
    package_name: apk?.packageName || null, preinstall: input.kind === "app" && input.preinstall,
    version_name:apk?.version,icon_data:apk?.icon,sha256:apk?.sha256,
  });
  if (error) return { error: error.message };
  revalidatePath("/library"); revalidatePath("/wallpapers"); revalidatePath("/apps");
  return { ok: input.shared ? "Published to RoboKorda library. Enable it for the schools that should receive it." : "Published. Devices download content on their next online sync." };
}

export async function changeLibraryItem(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff(); const school = await getCurrentSchool();
  if (!school || !canManage(staff, school.id)) return { error: "Administrator access required." };
  const supabase = await createClient(); const id = String(form.get("id")); const action = String(form.get("action"));
  const { data: item } = await supabase.from("hub_items").select("id,school_id,published").eq("id", id).maybeSingle();
  if (!item) return { error: "Item not found." };
  let error;
  if (action === "enable" && item.school_id === null) ({ error } = await supabase.from("hub_access").upsert({ item_id: id, school_id: school.id }));
  else if (action === "disable" && item.school_id === null) ({ error } = await supabase.from("hub_access").delete().eq("item_id", id).eq("school_id", school.id));
  else if (action === "publish" && (staff.role === "super_admin" || item.school_id === school.id)) ({ error } = await supabase.from("hub_items").update({ published: !item.published }).eq("id", id));
  else return { error: "Not allowed." };
  if (error) return { error: error.message };
  revalidatePath("/library"); revalidatePath("/wallpapers"); revalidatePath("/apps");
  return { ok: "Saved. Devices receive changes at the next sync." };
}

export async function saveHubSettings(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff(); const school = await getCurrentSchool();
  const global = form.get("global") === "on";
  if (!school || !canManage(staff, school.id) || (global && staff.role !== "super_admin")) return { error: "Administrator access required." };
  const supabase = await createClient(); const wallpaper = String(form.get("wallpaper") || "");
  if (wallpaper) {
    const { data: item } = await supabase.from("hub_items").select("id,school_id,kind,published").eq("id", wallpaper).maybeSingle();
    if (!item || item.kind !== "wallpaper" || !item.published || (global ? item.school_id !== null : item.school_id !== null && item.school_id !== school.id)) return { error: "Choose a published wallpaper in this scope." };
  }
  const { error } = await supabase.from("hub_settings").upsert({ scope: global ? "global" : school.id, school_id: global ? null : school.id,
    default_wallpaper_id: wallpaper || null, allow_wallpaper_choice: form.get("allow_choice") === "on", hide_vendor_store: form.get("hide_vendor_store") === "on" });
  if (error) return { error: error.message };
  revalidatePath("/settings"); revalidatePath("/library"); revalidatePath("/wallpapers"); return { ok: global ? "Master defaults saved for all schools without an override." : "School defaults saved." };
}

export async function reviewAppRequest(_prev: FormState, form: FormData): Promise<FormState> {
  await requireStaff(); const supabase = await createClient();
  const status = String(form.get("status"));
  if (!["reviewing", "approved", "declined"].includes(status)) return { error: "Invalid status." };
  const { data, error } = await supabase.from("hub_requests").update({ status }).eq("id", String(form.get("id"))).select("id");
  if (error || !data?.length) return { error: error?.message || "You cannot review this request." };
  revalidatePath("/apps"); revalidatePath("/requests"); return { ok: "Updated. Approved apps must also be published to the library." };
}
