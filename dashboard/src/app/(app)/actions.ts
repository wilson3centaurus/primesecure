"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireStaff, getVisibleSchools, SCHOOL_COOKIE } from "@/lib/auth";

export async function switchSchool(formData: FormData) {
  const staff = await requireStaff();
  if (staff.role !== "super_admin") return;
  const id = String(formData.get("school_id") ?? "");
  const schools = await getVisibleSchools();
  if (!schools.some((s) => s.id === id)) return;
  (await cookies()).set(SCHOOL_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
