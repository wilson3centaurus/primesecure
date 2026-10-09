import type { Metadata } from "next";
import { DeleteAppButton, InstallOnAllButton } from "@/components/app-forms";
import { PageHeader } from "@/components/page-header";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { App } from "@/lib/types";
import { UploadApp } from "./upload-app";

export const metadata: Metadata = { title: "Apps" };

function size(bytes: number | null) {
  if (!bytes) return "";
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export default async function AppsPage() {
  const staff = await requireStaff();
  const school = await getCurrentSchool();
  if (!school) return <PageHeader title="Apps" description="Add a school first." />;
  const manager = canManage(staff, school.id);

  const supabase = await createClient();
  const { data } = await supabase.from("apps").select("*").eq("school_id", school.id).order("name");
  const apps = (data ?? []) as App[];

  return (
    <>
      <PageHeader title="Apps" description="APKs your school installs silently on its Primebooks. Remove apps from a device on its page." />
      {manager && <div className="card mb-6 p-4"><UploadApp schoolId={school.id} /></div>}
      <div className="card divide-y divide-slate-100">
        {apps.length === 0 && <p className="p-4 text-sm text-slate-500">No apps in the library yet.</p>}
        {apps.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="font-medium">{a.name}</div>
              <div className="text-xs text-slate-500">{[size(a.size), `added ${dateTime(a.created_at)}`].filter(Boolean).join(" · ")}</div>
            </div>
            {manager && (
              <div className="flex items-start gap-4">
                <InstallOnAllButton appId={a.id} name={a.name} />
                <DeleteAppButton id={a.id} />
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
