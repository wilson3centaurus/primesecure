import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { getVisibleSchools, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CreateSchoolForm, RenameSchoolForm } from "./forms";

export const metadata: Metadata = { title: "Schools" };

export default async function SchoolsPage() {
  const staff = await requireStaff();
  if (staff.role !== "super_admin") redirect("/devices");

  const supabase = await createClient();
  const schools = await getVisibleSchools();
  const counts = new Map(
    await Promise.all(
      schools.map(async (s) => {
        const { count } = await supabase
          .from("devices")
          .select("id", { count: "exact", head: true })
          .eq("school_id", s.id);
        return [s.id, count ?? 0] as const;
      }),
    ),
  );

  return (
    <>
      <PageHeader title="Schools" description="Every school RoboKorda manages. Staff and devices belong to one school." />
      <div className="card mb-6 p-4"><CreateSchoolForm /></div>
      <div className="card divide-y divide-slate-100">
        {schools.length === 0 && <p className="p-4 text-sm text-slate-500">No schools yet.</p>}
        {schools.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <RenameSchoolForm id={s.id} name={s.name} />
            <span className="text-sm text-slate-500">{counts.get(s.id) ?? 0} devices</span>
          </div>
        ))}
      </div>
    </>
  );
}
