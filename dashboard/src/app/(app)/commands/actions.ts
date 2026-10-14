"use server";

import { revalidatePath } from "next/cache";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/types";

const MAX_MESSAGE = 12000;

export async function prepareMessageImageUpload(target: string, mime: string): Promise<{path?: string; error?: string}> {
  await requireStaff();
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) return {error:"Choose a JPG, PNG or WebP."};
  const supabase=await createClient();
  const school = target === "school" ? await getCurrentSchool() : (await supabase.from("devices").select("school_id").eq("id",target).maybeSingle()).data;
  const id=school && ("school_id" in school ? school.school_id : school.id);
  if (!id) return {error:"School or device not found."};
  return {path:`${id}/messages/${crypto.randomUUID()}.${mime.split("/")[1]}`};
}

// Messages may come from any staff member (RLS allows teachers 'message' only).
export async function sendMessage(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const body = String(formData.get("body") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim() || "Message from school";
  if (!body) return { error: "Type a message." };
  if (body.length > MAX_MESSAGE) return { error: `Keep it under ${MAX_MESSAGE} characters.` };

  const supabase = await createClient();
  const target = String(formData.get("target") ?? "");
  let deviceIds: string[];
  if (target === "school") {
    const school = await getCurrentSchool();
    if (!school) return { error: "No school selected." };
    let query = supabase
      .from("devices")
      .select("id")
      .eq("school_id", school.id)
      .in("status", ["active", "suspended", "locked"]);
    const form=String(formData.get("form_level") || "").trim(), klass=String(formData.get("class_name") || "").trim();
    if(form) query=query.eq("form_level",form);
    if(klass) query=query.eq("class_name",klass);
    const { data, error: targetsError } = await query;
    if(targetsError) return {error:targetsError.message};
    deviceIds = (data ?? []).map((d) => d.id);
    if (deviceIds.length === 0) return { error: "No enrolled devices to message." };
  } else {
    deviceIds = [target];
  }

  let imageUrl = String(formData.get("image_url") || "").trim();
  let imagePath: string | null = null;
  if (imageUrl && (!imageUrl.startsWith("https://") || imageUrl.length > 2048)) return { error: "Use an HTTPS image URL." };
  const uploadedPath = String(formData.get("image_path") || "");
  if (uploadedPath) {
    const { data: device } = await supabase.from("devices").select("school_id").eq("id", deviceIds[0]).maybeSingle();
    if (!device) return { error: "Device not found." };
    if (!uploadedPath.startsWith(`${device.school_id}/messages/`) || uploadedPath.includes("..")) return {error:"Invalid message image."};
    const slash=uploadedPath.lastIndexOf("/");
    const {data: files,error:verifyError}=await supabase.storage.from("primesecure-messages").list(uploadedPath.slice(0,slash),{search:uploadedPath.slice(slash+1)});
    const file=files?.find(f=>f.name===uploadedPath.slice(slash+1));
    if(verifyError || !file || Number(file.metadata?.size)>3_000_000 || !["image/jpeg","image/png","image/webp"].includes(file.metadata?.mimetype||'')) return {error:"Image upload could not be verified."};
    imagePath = uploadedPath;
    imageUrl = "";
  }
  const payload = { title: title.slice(0, 80), body, from: staff.fullName || staff.email, image_url: imageUrl || null, image_path: imagePath,
    require_ack: formData.get("require_ack") === "on", sent_at: new Date().toISOString(), broadcast_id:crypto.randomUUID() };
  const { error } = await supabase
    .from("commands")
    .insert(deviceIds.map((device_id) => ({ device_id, type: "message", payload, created_by: staff.id })));
  if (error) return { error: error.message };

  revalidatePath("/devices", "layout");
  revalidatePath("/messages");
  return { ok: deviceIds.length === 1 ? "Sent." : `Sent to ${deviceIds.length} devices.` };
}

export async function cancelCommand(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const { data: cmd } = await supabase.from("commands").select("id, school_id, device_id, status,type,payload").eq("id", id).maybeSingle();
  if (!cmd || !canManage(staff, cmd.school_id)) return { error: "You can't cancel this." };
  if (cmd.status !== "pending") return { error: "Already delivered; it can't be cancelled now." };

  const { data, error } = await supabase
    .from("commands")
    .update({ status: "cancelled",...(cmd.type==="reset_password"?{payload:{expires_at:cmd.payload?.expires_at}}:{}) })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error || !data?.length) return { error: error?.message ?? "Already delivered." };
  revalidatePath(`/devices/${cmd.device_id}`);
  return { ok: "Cancelled." };
}

export async function requestLocate(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const id = String(formData.get("device_id") ?? "");
  const supabase = await createClient();
  const { data: device } = await supabase.from("devices").select("id, school_id").eq("id", id).maybeSingle();
  if (!device || !canManage(staff, device.school_id)) return { error: "Only school admins can locate devices." };

  const { error } = await supabase.from("commands").insert({ device_id: id, type: "locate", created_by: staff.id });
  if (error) return { error: error.message };
  revalidatePath(`/devices/${id}`);
  return { ok: "Asked the device for its location. Online devices answer within a minute." };
}
