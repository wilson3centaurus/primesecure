"use server";

import { revalidatePath } from "next/cache";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/types";

export async function deleteWallpaper(_previous: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const school = await getCurrentSchool();
  if (!school || !canManage(staff, school.id)) return { error: "Administrator access required." };
  const db = await createClient();
  const id = String(form.get("id") || "");
  const { data: item, error: readError } = await db.from("hub_items")
    .select("id,school_id,kind,storage_path").eq("id", id).maybeSingle();
  if (readError) return { error: readError.message };
  if (!item || item.kind !== "wallpaper") return { error: "Wallpaper not found." };
  if (item.school_id === null ? staff.role !== "super_admin" : item.school_id !== school.id) {
    return { error: "You can only delete wallpapers you manage." };
  }
  // Verify an affected row before removing the stored image; RLS can deny a delete silently.
  const { data: removed, error } = await db.from("hub_items").delete().eq("id", item.id)
    .eq("kind", "wallpaper").select("id");
  if (error || !removed?.length) return { error: error?.message || "Wallpaper was not deleted. Refresh and try again." };
  const { error: cleanupError } = await db.storage.from("primesecure-hub").remove([item.storage_path]);
  revalidatePath("/library"); revalidatePath("/wallpapers"); revalidatePath("/settings");
  return { ok: cleanupError ? "Wallpaper deleted. Stored-image cleanup needs attention." : "Wallpaper deleted. Devices receive the updated gallery at their next sync." };
}
