import type { Metadata } from "next";
import { DeleteAppButton, InstallOnAllButton } from "@/components/app-forms";
import { PageHeader } from "@/components/page-header";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { App } from "@/lib/types";
import { UploadApp } from "./upload-app";
import { SectionTabs } from "@/components/section-tabs";
import { ManagementSettings } from "@/components/management-settings";
import { AppRules } from "@/components/app-rules";
import { AppRequests } from "@/components/app-requests";
import { HubLibrary } from "@/components/hub-library";

export const metadata: Metadata = { title: "Apps" };
export const maxDuration = 120;

function size(bytes: number | null) {
  if (!bytes) return "";
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export default async function AppsPage({searchParams}:{searchParams:Promise<{tab?:string}>}) {
  const staff = await requireStaff();
  const school = await getCurrentSchool();
  if (!school) return <PageHeader title="Apps" description="Add a school first." />;
  const manager = canManage(staff, school.id);

  const supabase = await createClient();
  const { data } = await supabase.from("apps").select("*").eq("school_id", school.id).order("name");
  const apps = (data ?? []) as App[];
  const {tab="store"}=await searchParams;
  const tabs=[{id:"store",label:"App Store"},{id:"requests",label:"Student requests"},...(manager?[{id:"rules",label:"App rules"},{id:"viewers",label:"Media viewers"},{id:"legacy",label:"Older deployments"}]:[])];
  const current=tabs.some(t=>t.id===tab)?tab:"store";
  const [{data:settings},{data:global},{data:approved},{data:access}]=await Promise.all([
    supabase.from("hub_settings").select("*").eq("scope",school.id).maybeSingle(),
    supabase.from("hub_settings").select("*").eq("scope","global").maybeSingle(),
    supabase.from("hub_items").select("id,title,package_name,school_id").eq("kind","app").eq("published",true).or(`school_id.is.null,school_id.eq.${school.id}`),
    supabase.from("hub_access").select("item_id").eq("school_id",school.id)
  ]);
  const available=[...new Map((approved||[]).filter(a=>a.school_id===school.id||(access||[]).some(x=>x.item_id===a.id)).map(a=>[a.package_name,a])).values()];
  const navigation=<SectionTabs base="/apps" current={current} tabs={tabs}/>;
  if(current==="requests")return <>{navigation}<AppRequests/></>;
  if(current==="viewers")return <>{navigation}<PageHeader title="Media viewers" description="Choose which approved app opens each file type."/><ManagementSettings section="viewers" settings={settings||global||{}} apps={available}/></>;
  if(current==="rules")return <>{navigation}<AppRules strict={settings?.approved_apps_only??global?.approved_apps_only??true} approvedCount={available.length} blocked={settings?.blocked_packages??global?.blocked_packages??[]}/></>;
  if(current==="store")return <>{navigation}<HubLibrary kind="app"/></>;

  return (
    <>
      {navigation}
      <details className="card mt-10 p-5"><summary className="cursor-pointer font-semibold text-slate-600">Previous administrator deployments ({apps.length})</summary><div className="mt-5"><PageHeader title="Administrator deployments" description="Existing direct-install library. Upload above to make an app available in the student App Store." /></div>
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
      </details>
    </>
  );
}
