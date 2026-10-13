"use server";

import { revalidatePath } from "next/cache";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/types";

const MAX_MESSAGE = 12000;

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
    const { data } = await supabase
      .from("devices")
      .select("id")
      .eq("school_id", school.id)
      .in("status", ["active", "suspended", "locked"]);
    deviceIds = (data ?? []).map((d) => d.id);
    if (deviceIds.length === 0) return { error: "No enrolled devices to message." };
  } else {
    deviceIds = [target];
  }

  let imageUrl = String(formData.get("image_url") || "").trim();
  let imagePath: string | null = null;
  if (imageUrl && (!imageUrl.startsWith("https://") || imageUrl.length > 2048)) return { error: "Use an HTTPS image URL." };
  const image = formData.get("image");
  if (image instanceof File && image.size > 0) {
    if (image.size > 3_000_000 || !["image/jpeg", "image/png", "image/webp"].includes(image.type)) return { error: "Use a JPG, PNG or WebP image smaller than 3 MB." };
    const { data: device } = await supabase.from("devices").select("school_id").eq("id", deviceIds[0]).maybeSingle();
    if (!device) return { error: "Device not found." };
    const path = `${device.school_id}/messages/${crypto.randomUUID()}.${image.type.split("/")[1]}`;
    const { error: uploadError } = await supabase.storage.from("primesecure-messages").upload(path, image, { contentType: image.type });
    if (uploadError) return { error: uploadError.message };
    imagePath = path;
    imageUrl = "";
  }
  const payload = { title: title.slice(0, 80), body, from: staff.fullName || staff.email, image_url: imageUrl || null, image_path: imagePath,
    require_ack: formData.get("require_ack") === "on", sent_at: new Date().toISOString() };
  const { error } = await supabase
    .from("commands")
    .insert(deviceIds.map((device_id) => ({ device_id, type: "message", payload, created_by: staff.id })));
  if (error) return { error: error.message };

  revalidatePath("/devices", "layout");
  return { ok: deviceIds.length === 1 ? "Sent." : `Sent to ${deviceIds.length} devices.` };
}

export async function cancelCommand(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const { data: cmd } = await supabase.from("commands").select("id, school_id, device_id, status").eq("id", id).maybeSingle();
  if (!cmd || !canManage(staff, cmd.school_id)) return { error: "You can't cancel this." };
  if (cmd.status !== "pending") return { error: "Already delivered; it can't be cancelled now." };

  const { data, error } = await supabase
    .from("commands")
    .update({ status: "cancelled" })
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
