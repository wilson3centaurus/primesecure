"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function setDeviceLicence(formData: FormData): Promise<void> {
  const staff = await requireStaff();
  const school = await getCurrentSchool();
  const device = String(formData.get("device_id") ?? "");
  const state = String(formData.get("state") ?? "");
  if (!school || !canManage(staff, school.id) || !/^[0-9a-f-]{36}$/i.test(device) || !["good", "expired"].includes(state)) {
    redirect("/licences?error=School+administrator+access+required.");
  }
  const db = await createClient();
  const { error } = await db.rpc("staff_set_device_licence", { p_device: device, p_state: state });
  if (error) redirect(`/licences?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/licences");
  redirect(`/licences?notice=${encodeURIComponent(state === "good" ? "Licence marked good." : "Licence marked expired.")}`);
}
