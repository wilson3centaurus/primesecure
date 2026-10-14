"use server";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/types";

export async function deleteMessages(_prev: FormState, form: FormData): Promise<FormState> {
  await requireStaff();
  let ids: string[];
  try {
    const value: unknown = JSON.parse(String(form.get("ids") || "[]"));
    if (!Array.isArray(value) || value.length < 1 || value.length > 500 || value.some(id => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) return { error: "Select up to 500 message recipients." };
    ids = [...new Set(value)] as string[];
  } catch { return { error: "Invalid message selection." }; }
  const db = await createClient();
  const { error } = await db.rpc("staff_delete_messages", { p_ids: ids });
  if (error) return { error: error.message };
  revalidatePath("/messages"); revalidatePath("/devices", "layout");
  return { ok: "Deleted. Primebooks remove their copy when they sync (0.6.0 or newer)." };
}
