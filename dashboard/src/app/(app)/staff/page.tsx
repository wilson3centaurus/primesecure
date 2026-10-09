import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { canManage, getCurrentSchool, requireStaff, ROLE_LABEL } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { AddStaffForm, StaffActions } from "./forms";

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
  const admin = createAdminClient();
  const emails = new Map(
    await Promise.all(
      people.map(async (p) => {
        const { data: u } = await admin.auth.admin.getUserById(p.id);
        return [p.id, u.user?.email ?? ""] as const;
      }),
    ),
  );
  const manager = canManage(staff, school.id);

  return (
    <>
      <PageHeader title="Staff" description={`People who can sign in to manage ${school.name}.`} />
      {manager && <div className="card mb-6 p-4"><AddStaffForm /></div>}
      <div className="card divide-y divide-slate-100">
        {people.length === 0 && <p className="p-4 text-sm text-slate-500">No staff yet.</p>}
        {people.map((p) => (
          <div key={p.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div>
              <div className="font-medium">{p.full_name || "—"}{p.id === staff.id && <span className="ml-2 text-xs text-slate-400">(you)</span>}</div>
              <div className="text-sm text-slate-500">{emails.get(p.id)}</div>
            </div>
            {manager && p.id !== staff.id && p.role !== "super_admin" ? (
              <StaffActions id={p.id} role={p.role} />
            ) : (
              <span className="text-sm text-slate-600">{ROLE_LABEL[p.role]}</span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
