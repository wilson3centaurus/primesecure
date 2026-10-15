import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { canManage, getCurrentSchool, requireStaff, ROLE_LABEL } from "@/lib/auth";
import { createAdminClient, hasAdminConfig } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { AddStaffForm, StaffActions } from "./forms";
import { Info } from "lucide-react";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage() {
  const staff = await requireStaff();
  const school = await getCurrentSchool();
  if (!school) return <PageHeader title="Staff" description="Add a school first." />;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, school_id, role, full_name, created_at")
    .eq("school_id", school.id)
    .order("role")
    .order("full_name");
  const people = (data ?? []) as Profile[];

  // Emails live in auth.users, which only the service role can read. RLS has
  // already limited `people` to staff this user may see.
  const loginManagement = hasAdminConfig();
  const emails = new Map([[staff.id, staff.email]]);
  let emailsUnavailable = !loginManagement;
  if (loginManagement) {
    const admin = createAdminClient();
    const lookups = await Promise.allSettled(people.filter(p => p.id !== staff.id).map(async p => {
      const { data, error } = await admin.auth.admin.getUserById(p.id);
      if (error || !data.user?.email) throw new Error("Email unavailable");
      return [p.id, data.user.email] as const;
    }));
    for (const result of lookups) {
      if (result.status === "fulfilled") emails.set(...result.value);
      else emailsUnavailable = true;
    }
  }
  const manager = canManage(staff, school.id);

  return (
    <>
      <PageHeader title="Staff" description={`People who can sign in to manage ${school.name}.`} />
      {emailsUnavailable && <div role="status" className="card mb-4 flex items-start gap-2.5 bg-panel p-3 text-xs text-muted"><Info size={15} className="mt-0.5 shrink-0"/><p>{!loginManagement && manager ? "Login management is unavailable in this environment. You can still view staff and change roles. Adding staff, resetting passwords and removing logins are unavailable." : "Some staff email addresses are unavailable. Staff names and roles are still shown."}</p></div>}
      {manager && loginManagement && <div className="card mb-5 p-4"><AddStaffForm /></div>}
      <div className="card divide-y divide-slate-100">
        {people.length === 0 && <p className="p-4 text-sm text-slate-500">No staff yet.</p>}
        {people.map((p) => (
          <div key={p.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div>
              <div className="font-medium">{p.full_name || "—"}{p.id === staff.id && <span className="ml-2 text-xs text-slate-400">(you)</span>}</div>
              <div className="mt-1 text-xs text-muted">{emails.get(p.id) || "Email unavailable"}</div>
            </div>
            {manager && p.id !== staff.id && p.role !== "super_admin" ? (
              <StaffActions id={p.id} role={p.role} loginManagement={loginManagement} />
            ) : (
              <span className="text-sm text-slate-600">{ROLE_LABEL[p.role]}</span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
