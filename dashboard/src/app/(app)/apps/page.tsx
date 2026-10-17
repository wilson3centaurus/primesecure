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

export default async function AppsPage({searchParams}:{searchParams:Promise<{tab?:string;q?:string;page?:string;status?:string;install?:string}>}) {
  const staff = await requireStaff();
  const school = await getCurrentSchool();
  if (!school) return <PageHeader title="Apps" description="Add a school first." />;
  const manager = canManage(staff, school.id);

  const supabase = await createClient();
  const params=await searchParams;
  const {tab="store"}=params;
  const tabs=[{id:"store",label:"App Store"},{id:"requests",label:"Student requests"},...(manager?[{id:"rules",label:"App rules"},{id:"viewers",label:"Media viewers"},{id:"legacy",label:"Older deployments"}]:[])];
  const current=tabs.some(t=>t.id===tab)?tab:"store";
  const navigation=<SectionTabs base="/apps" current={current} tabs={tabs}/>;
  if(current==="store")return <>{navigation}<HubLibrary kind="app" query={typeof params.q==='string'?params.q:''} page={Number(params.page)||1} status={typeof params.status==='string'?params.status:'all'} install={typeof params.install==='string'?params.install:'all'}/></>;
  if(current==="requests")return <>{navigation}<AppRequests/></>;
  if(current==="legacy") {
    const {data}=await supabase.from("apps").select("*").eq("school_id",school.id).order("name");
    const apps=(data??[]) as App[];
    return <>{navigation}<PageHeader title="Administrator deployments" description="Previous direct-install library. Publish an APK in App Store to make it available to students."/>{manager&&<details className="card mb-4 p-4"><summary className="cursor-pointer text-xs font-semibold">Upload administrator deployment</summary><div className="mt-4"><UploadApp schoolId={school.id}/></div></details>}<div className="card divide-y divide-slate-100">{!apps.length&&<p className="p-5 text-xs text-muted">No administrator deployments yet.</p>}{apps.map(app=><div key={app.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-xs font-semibold">{app.name}</p><p className="mt-1 text-[11px] text-muted">{size(app.size)} · {dateTime(app.created_at)}</p></div>{manager&&<div className="flex gap-3"><InstallOnAllButton appId={app.id} name={app.name}/><DeleteAppButton id={app.id}/></div>}</div>)}</div></>;
  }
  const [{data:settings},{data:global},{data:approved},{data:access}]=await Promise.all([
    supabase.from("hub_settings").select("*").eq("scope",school.id).maybeSingle(),
    supabase.from("hub_settings").select("*").eq("scope","global").maybeSingle(),
    supabase.from("hub_items").select("id,title,package_name,school_id").eq("kind","app").eq("published",true).or(`school_id.is.null,school_id.eq.${school.id}`),
    supabase.from("hub_access").select("item_id").eq("school_id",school.id)
  ]);
  const available=[...new Map((approved||[]).filter(a=>a.school_id===school.id||(access||[]).some(x=>x.item_id===a.id)).map(a=>[a.package_name,a])).values()];
  if(current==="viewers")return <>{navigation}<PageHeader title="Media viewers" description="Choose which approved app opens each file type."/><ManagementSettings section="viewers" settings={settings||global||{}} apps={available}/></>;
  if(current==="rules")return <>{navigation}<AppRules strict={settings?.approved_apps_only??global?.approved_apps_only??true} approvedCount={available.length} blocked={settings?.blocked_packages??global?.blocked_packages??[]}/></>;

  return null;
}
