"use server";

import { revalidatePath } from "next/cache";
import { canManage, getCurrentSchool, requireStaff, type Staff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, FormState } from "@/lib/types";

const ASSIGNABLE: AppRole[] = ["school_admin", "teacher"];

// Loads a staff member the caller is allowed to manage: same school (or
// super_admin), never a super_admin, never themselves. Mirrors profiles RLS so
// service-role calls below can't reach further than the caller could.
async function manageableProfile(staff: Staff, id: string) {
  const supabase = await createClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("id, role, school_id")
    .eq("id", id)
    .maybeSingle();
  if (!target || !target.school_id) return null;
  if (target.id === staff.id || target.role === "super_admin") return null;
  if (!canManage(staff, target.school_id)) return null;
  return target;
}

export async function addStaff(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const school = await getCurrentSchool();
  if (!school || !canManage(staff, school.id)) return { error: "You can't add staff to this school." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "") as AppRole;
  if (!email || !fullName) return { error: "Enter a name and email." };
  if (password.length < 8) return { error: "Temporary password must be at least 8 characters." };
  if (!ASSIGNABLE.includes(role)) return { error: "Pick a role." };

  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !created.user) {
    return { error: /already/i.test(error?.message ?? "") ? "That email already has an account." : (error?.message ?? "Could not create the login.") };
  }

  const { error: profileError } = await admin
    .from("profiles")
    .insert({ id: created.user.id, school_id: school.id, role, full_name: fullName });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: profileError.message };
  }

  revalidatePath("/staff");
  return { ok: `Added ${fullName}. They can sign in with ${email} and the temporary password.` };
}

export async function changeRole(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const id = String(formData.get("id") ?? "");
  const role = String(formData.get("role") ?? "") as AppRole;
  if (!ASSIGNABLE.includes(role)) return { error: "Pick a role." };
  if (!(await manageableProfile(staff, id))) return { error: "You can't change this person's role." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").update({ role }).eq("id", id).select("id");
  if (error || !data?.length) return { error: error?.message ?? "Not allowed." };
  revalidatePath("/staff");
  return { ok: "Role updated." };
}

export async function resetPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const id = String(formData.get("id") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "At least 8 characters." };
  if (!(await manageableProfile(staff, id))) return { error: "You can't reset this password." };

  const { error } = await createAdminClient().auth.admin.updateUserById(id, { password });
  if (error) return { error: error.message };
  return { ok: "Password changed." };
}

export async function removeStaff(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const id = String(formData.get("id") ?? "");
  if (!(await manageableProfile(staff, id))) return { error: "You can't remove this person." };

  // Delete through RLS first; only drop the login once that succeeded.
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").delete().eq("id", id).select("id");
  if (error || !data?.length) return { error: error?.message ?? "Not allowed." };
  await createAdminClient().auth.admin.deleteUser(id);

  revalidatePath("/staff");
  return { ok: "Removed." };
}
