"use server";

import { revalidatePath } from "next/cache";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requestRemoteControl(_previous: FormState, form: FormData): Promise<FormState> {
  const [staff, school] = await Promise.all([requireStaff(), getCurrentSchool()]);
  if (!school || !canManage(staff, school.id)) return { error: "School administrator access required." };
  const device = String(form.get("device_id") || "");
  const type = String(form.get("type") || "");
  const reason = String(form.get("reason") || "").trim();
  const kind = String(form.get("kind") || "");
  const linkedCase = String(form.get("case_id") || "");
  const seconds = Number(form.get("seconds") || 15);
  if (!uuid.test(device) || !["alarm", "request_capture"].includes(type) || reason.length < 5 || reason.length > 500 || form.get("authorized") !== "on") {
    return { error: "Choose a device, enter a reason (5–500 characters), and confirm documented school authorization." };
  }
  if (type === "alarm" && (!Number.isInteger(seconds) || seconds < 5 || seconds > 30)) return { error: "Alarm duration must be 5 to 30 seconds." };
  if (type === "request_capture" && (!["photo", "screenshot"].includes(kind) || (linkedCase && !uuid.test(linkedCase)))) return { error: "Choose a photo or screenshot and a valid case." };
  const db = await createClient();
  const { data: current, error: readError } = await db.from("devices").select("id,school_id,status").eq("id", device).eq("school_id", school.id).maybeSingle();
  if (readError || !current || !canManage(staff, current.school_id) || ["pending", "retired"].includes(current.status)) return { error: "Choose an enrolled device in the current school." };
  const { error } = await db.rpc("staff_request_remote_control", {
    p_device: device, p_type: type, p_reason: reason, p_authorized: true,
    p_seconds: seconds, p_kind: type === "request_capture" ? kind : null, p_case: linkedCase || null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/devices/${device}`);
  if (linkedCase) revalidatePath("/cases");
  return { ok: type === "alarm"
    ? "Alarm queued for the connected Primebook; expires after 2 minutes. Visible Stop control, maximum 30 seconds; normal device audio policies apply."
    : "Visible capture request queued; expires after 10 minutes. The student must allow, review and send one image. No automatic capture or live feed." };
}
