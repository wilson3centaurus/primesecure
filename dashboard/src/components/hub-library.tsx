import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { HubItemAction, HubSettingsForm, HubUpload } from "./hub-forms";
import { PageHeader } from "./page-header";
import { dateTime } from "@/lib/format";
import Image from "next/image";
import { FolderLibrary } from "./folder-library";
import { AppWindow } from "lucide-react";

export async function HubLibrary({ kind,settingsOnly=false }: { kind: "resource" | "wallpaper" | "app";settingsOnly?:boolean }) {
  const staff = await requireStaff(); const school = await getCurrentSchool();
  if (!school) return <PageHeader title="Student library" description="Create a school first." />;
  const supabase = await createClient();
  const [{ data: items, error }, { data: access }, { data: settings },{data:groups}] = await Promise.all([
    supabase.from("hub_items").select("*").eq("kind", kind).or(`school_id.is.null,school_id.eq.${school.id}`).order("created_at", { ascending: false }),
    supabase.from("hub_access").select("item_id").eq("school_id", school.id),
    supabase.from("hub_settings").select("*").or(`scope.eq.global,school_id.eq.${school.id}`),
    supabase.from("school_classes").select("form_level,class_name").eq("school_id",school.id),
  ]);
  const manager = canManage(staff, school.id); const enabled = new Set((access || []).map(a => a.item_id));
  const { data: previews } = items?.length ? await supabase.storage.from("primesecure-hub").createSignedUrls(items.map(i => i.storage_path), 600) : { data: [] };
  const previewUrls = new Map((previews || []).map(p => [p.path, p.signedUrl]));
  const title = kind === "resource" ? "School Notes" : kind === "wallpaper" ? "Wallpapers" : "App Store";
  const defaults=<>
    {kind === "wallpaper" && manager && <div className="grid gap-5 lg:grid-cols-2">
      <div className="card p-5"><h2 className="mb-4 font-semibold">{school.name} defaults</h2><HubSettingsForm wallpapers={(items || []).filter(i => i.published)} settings={settings?.find(s => s.school_id === school.id) || null} /></div>
      {staff.role === "super_admin" && <div className="card p-5"><h2 className="mb-4 font-semibold">RoboKorda master defaults</h2><p className="mb-4 text-sm text-slate-500">Applies across schools without their own settings. New devices receive these at enrollment.</p><HubSettingsForm global wallpapers={(items || []).filter(i => i.published && i.school_id === null)} settings={settings?.find(s => s.scope === "global") || null} /></div>}
    </div>}
  </>;
  if(settingsOnly)return defaults;
  return <section className="space-y-6">
    <PageHeader title={title} description={kind === "resource" ? "An organised, offline-ready learning library for every Primebook." : kind === "app" ? "Only approved apps appear in the student hub. Publish, assign and preinstall from one place." : "Set your school's look. Give students a choice within your approved gallery."} />
    {error && <p role="alert" className="card p-4 text-red-700">Library unavailable: {error.message}</p>}
    {kind==='app'&&manager&&<details className="rounded-xl border border-slate-200 bg-white p-4" open={!items?.length}><summary className="cursor-pointer text-sm font-semibold text-brand-700">+ Upload an APK</summary><p className="mt-3 text-sm text-slate-500">Name, icon, version and package are read from the file.</p><div className="mt-4"><HubUpload key={school.id} kind="app" schoolId={school.id} superAdmin={staff.role==='super_admin'}/></div></details>}
    {kind==='resource'&&<FolderLibrary items={(items||[]).map(i=>({...i,url:previewUrls.get(i.storage_path)}))} schoolId={school.id} superAdmin={staff.role==='super_admin'} manager={manager} enabled={[...enabled]} forms={[...new Set((groups||[]).map(g=>g.form_level))]}/>}
    {kind==='wallpaper'&&manager && <details className="card p-5"><summary className="cursor-pointer font-semibold text-brand-700">+ Publish a wallpaper</summary><div className="pt-5"><HubUpload kind={kind} schoolId={school.id} superAdmin={staff.role === "super_admin"} /></div></details>}
    {kind==='app'&&<div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 xl:grid-cols-5">{(items||[]).map(item=><article key={item.id} className="flex min-w-0 flex-col items-start">
      <div className="mb-3 flex aspect-square w-full max-w-44 items-center justify-center overflow-hidden rounded-3xl border border-slate-200 bg-white text-brand-500 shadow-sm">{item.icon_data?<Image unoptimized src={item.icon_data} alt={item.title} width={176} height={176} className="h-full w-full object-contain"/>:<AppWindow size={60}/>}</div>
      <h2 className="text-sm font-medium leading-5">{item.title}</h2><p className="mt-1 text-xs text-slate-500">{[item.version_name,(item.size/1048576).toFixed(1)+' MB'].filter(Boolean).join(' · ')}</p>
      <span className={`mt-2 text-xs ${item.published&&(item.school_id||enabled.has(item.id))?'text-emerald-700':'text-slate-400'}`}>{item.published&&(item.school_id||enabled.has(item.id))?'Approved for school':'Not available to students'}{item.preinstall?' · Preinstall':''}</span>
      <details className="mt-3 text-xs"><summary className="cursor-pointer text-slate-500">Manage</summary><div className="mt-3 flex flex-wrap gap-2">{manager&&!item.school_id&&<HubItemAction id={item.id} action={enabled.has(item.id)?'disable':'enable'}>{enabled.has(item.id)?'Disable for school':'Enable for school'}</HubItemAction>}{previewUrls.get(item.storage_path)&&<a className="btn-secondary" href={previewUrls.get(item.storage_path)||undefined} target="_blank" rel="noreferrer">Download APK</a>}{manager&&(staff.role==='super_admin'||item.school_id===school.id)&&<HubItemAction id={item.id} action="publish">{item.published?'Withdraw':'Republish'}</HubItemAction>}</div></details>
    </article>)}</div>}
    {kind==='wallpaper'&&<div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{(items||[]).map(item=><article key={item.id} className="card overflow-hidden">{previewUrls.get(item.storage_path)&&<Image unoptimized src={previewUrls.get(item.storage_path)!} alt={item.title} width={800} height={450} className="aspect-video w-full object-cover"/>}<div className="space-y-3 p-4"><h2 className="text-sm font-semibold">{item.title}</h2><p className="text-xs text-slate-500">{(item.size/1048576).toFixed(1)} MB · {dateTime(item.created_at)}</p><div className="flex flex-wrap gap-2">{manager&&!item.school_id&&<HubItemAction id={item.id} action={enabled.has(item.id)?'disable':'enable'}>{enabled.has(item.id)?'Disable for school':'Enable for school'}</HubItemAction>}{manager&&(staff.role==='super_admin'||item.school_id===school.id)&&<HubItemAction id={item.id} action="publish">{item.published?'Withdraw':'Republish'}</HubItemAction>}</div></div></article>)}</div>}
    {kind!=='resource'&&!items?.length && !error && <div className="card p-12 text-center"><h2 className="text-xl font-semibold">Your library starts here</h2><p className="mt-2 text-slate-500">Publish a file above. Shared items reach students only after their school enables them.</p></div>}
  </section>;
}
