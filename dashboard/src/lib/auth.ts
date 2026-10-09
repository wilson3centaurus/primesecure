import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, School } from "@/lib/types";

export type Staff = {
  id: string;
  email: string;
  role: AppRole;
  schoolId: string | null;
  fullName: string | null;
};

export const SCHOOL_COOKIE = "ps_school";

// The signed-in staff member, verified with the auth server. Device accounts
// and stray users have no profile and are turned away.
export const requireStaff = cache(async (): Promise<Staff> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, school_id, full_name")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) redirect("/no-access");

  return {
    id: user.id,
    email: user.email ?? "",
    role: profile.role,
    schoolId: profile.school_id,
    fullName: profile.full_name,
  };
});

// Schools the user can see (RLS-filtered: one for school staff, all for super_admin).
export const getVisibleSchools = cache(async (): Promise<School[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("schools").select("id, name, created_at").order("name");
  return data ?? [];
});

// The school the dashboard is working in. School staff are pinned to their
// own; a super_admin picks one with the switcher (cookie), defaulting to the first.
export const getCurrentSchool = cache(async (): Promise<School | null> => {
  const staff = await requireStaff();
  const schools = await getVisibleSchools();
  if (staff.role !== "super_admin") {
    return schools.find((s) => s.id === staff.schoolId) ?? null;
  }
  const picked = (await cookies()).get(SCHOOL_COOKIE)?.value;
  return schools.find((s) => s.id === picked) ?? schools[0] ?? null;
});

export function canManage(staff: Staff, schoolId: string) {
  return staff.role === "super_admin" || (staff.role === "school_admin" && staff.schoolId === schoolId);
}

export const ROLE_LABEL: Record<AppRole, string> = {
  super_admin: "RoboKorda admin",
  school_admin: "School admin",
  teacher: "Teacher",
};
