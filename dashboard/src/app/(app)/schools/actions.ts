"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/types";

export async function createSchool(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  if (staff.role !== "super_admin") return { error: "Only RoboKorda admins can add schools." };
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Enter a school name." };

  const supabase = await createClient();
  const { error } = await supabase.from("schools").insert({ name });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: `Added ${name}.` };
}

export async function renameSchool(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  if (staff.role !== "super_admin") return { error: "Only RoboKorda admins can rename schools." };
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Enter a school name." };

  const supabase = await createClient();
  const { error } = await supabase.from("schools").update({ name }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: "Saved." };
}
