"use server";

import { revalidatePath } from "next/cache";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function updateCase(_previous: FormState, form: FormData): Promise<FormState> {
  const [staff, school] = await Promise.all([requireStaff(), getCurrentSchool()]);
  if (!school || !canManage(staff, school.id)) return { error: "School administrator access required." };
  const id = String(form.get("case_id") || "");
  const state = String(form.get("state") || "");
  const note = String(form.get("note") || "").trim();
  if (!uuid.test(id) || !["open", "observing", "resolved"].includes(state) || note.length > 4000) return { error: "Choose a valid case state and enter a note of up to 4,000 characters." };
  const db = await createClient();
  const { data: current, error: loadError } = await db.from("device_cases").select("id,school_id").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (loadError || !current || !canManage(staff, current.school_id)) return { error: "This case is not available in the current school." };
  const { error } = await db.rpc("staff_update_case", { p_case: id, p_state: state, p_note: note });
  if (error) return { error: error.message };
  revalidatePath("/cases");
  revalidatePath("/reports");
  return { ok: "Case updated. Device app rules remain unchanged." };
}

export async function createCase(_previous: FormState, form: FormData): Promise<FormState> {
  const [staff, school] = await Promise.all([requireStaff(), getCurrentSchool()]);
  if (!school || !canManage(staff, school.id)) return { error: "School administrator access required." };
  const device = String(form.get("device_id") || "");
  const title = String(form.get("title") || "").trim();
  const note = String(form.get("note") || "").trim();
  if (!uuid.test(device) || !title || title.length > 200 || note.length > 4000) return { error: "Choose a student, enter a title of up to 200 characters and a note of up to 4,000 characters." };
  const db = await createClient();
  const { data: current, error: loadError } = await db.from("devices").select("id,school_id").eq("id", device).eq("school_id", school.id).maybeSingle();
  if (loadError || !current || !canManage(staff, current.school_id)) return { error: "Choose a student in the current school." };
  const { error } = await db.rpc("staff_create_case", { p_device: device, p_title: title, p_note: note });
  if (error) return { error: error.message };
  revalidatePath("/cases");
  return { ok: "Case opened. Find it in Open or All states." };
}
