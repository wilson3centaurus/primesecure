import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { HubItemAction, HubSettingsForm, HubUpload } from "./hub-forms";
import { PageHeader } from "./page-header";
import { dateTime } from "@/lib/format";
import Image from "next/image";
import { FolderLibrary } from "./folder-library";
import { AppCatalog } from "./app-catalog";

export async function HubLibrary({ kind }: { kind: "resource" | "wallpaper" | "app" }) {
  const staff = await requireStaff(); const school = await getCurrentSchool();
  if (!school) return <PageHeader title="Student library" description="Create a school first." />;
  const supabase = await createClient();
  const [{ data: items, error }, { data: access }, { data: settings }] = await Promise.all([
    supabase.from("hub_items").select("*").eq("kind", kind).or(`school_id.is.null,school_id.eq.${school.id}`).order("created_at", { ascending: false }),
    supabase.from("hub_access").select("item_id").eq("school_id", school.id),
    supabase.from("hub_settings").select("*").or(`scope.eq.global,school_id.eq.${school.id}`),
  ]);
  const manager = canManage(staff, school.id); const enabled = new Set((access || []).map(a => a.item_id));
  const { data: previews } = items?.length ? await supabase.storage.from("primesecure-hub").createSignedUrls(items.map(i => i.storage_path), 600) : { data: [] };
  const previewUrls = new Map((previews || []).map(p => [p.path, p.signedUrl]));
  const title = kind === "resource" ? "School Notes" : kind === "wallpaper" ? "Wallpapers & defaults" : "Student app library";
  return <section className="space-y-6">
    <PageHeader title={title} description={kind === "resource" ? "An organised, offline-ready learning library for every Primebook." : kind === "app" ? "Only approved apps appear in the student hub. Publish, assign and preinstall from one place." : "Set your school's look. Give students a choice within your approved gallery."} />
    {error && <p role="alert" className="card p-4 text-red-700">Library unavailable: {error.message}</p>}
    {kind==='app'&&manager&&<AppCatalog key={school.id} schoolId={school.id}/>}
    {kind==='resource'&&<FolderLibrary items={(items||[]).map(i=>({...i,url:previewUrls.get(i.storage_path)}))} schoolId={school.id} superAdmin={staff.role==='super_admin'} manager={manager} enabled={[...enabled]}/>}
    {kind!=='resource'&&manager && <details className="card p-5"><summary className="cursor-pointer font-semibold text-brand-700">+ Publish {kind === "wallpaper" ? "a wallpaper" : "your own APK"}</summary><div className="pt-5"><HubUpload kind={kind} schoolId={school.id} superAdmin={staff.role === "super_admin"} /></div></details>}
    {kind === "wallpaper" && manager && <div className="grid gap-5 lg:grid-cols-2">
      <div className="card p-5"><h2 className="mb-4 font-semibold">{school.name} defaults</h2><HubSettingsForm wallpapers={(items || []).filter(i => i.published)} settings={settings?.find(s => s.school_id === school.id) || null} /></div>
      {staff.role === "super_admin" && <div className="card p-5"><h2 className="mb-4 font-semibold">RoboKorda master defaults</h2><p className="mb-4 text-sm text-slate-500">Applies across schools without their own settings. New devices receive these at enrollment.</p><HubSettingsForm global wallpapers={(items || []).filter(i => i.published && i.school_id === null)} settings={settings?.find(s => s.scope === "global") || null} /></div>}
    </div>}
    {kind!=='resource'&&<div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{(items || []).map(item => <article key={item.id} className="card flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between text-xs"><span className="rounded-full bg-brand-50 px-3 py-1 font-medium text-brand-700">{item.school_id ? "School library" : "RoboKorda shared"}</span><span className={item.published ? "text-emerald-700" : "text-slate-400"}>{item.published ? "Published" : "Withdrawn"}</span></div>
      <div><h2 className="text-lg font-semibold">{item.title}</h2><p className="mt-1 text-sm text-slate-500">{[item.form_level, item.subject, item.category].filter(Boolean).join(" / ")}</p></div>
      {kind==='app'&&item.icon_data&&<Image unoptimized src={item.icon_data} alt="" width={64} height={64} className="h-16 w-16 rounded-2xl object-contain"/>}
      {kind === "wallpaper" && previewUrls.get(item.storage_path) && <Image unoptimized src={previewUrls.get(item.storage_path)!} alt={item.title} width={800} height={450} className="aspect-video w-full rounded-xl object-cover" />}
      <p className="text-sm text-slate-600">{item.description}</p>
      <p className="text-xs text-slate-500">{(item.size / 1048576).toFixed(1)} MB · {dateTime(item.created_at)}{item.preinstall ? " · Auto-install" : ""}</p>
      {kind === "app" && <span className="text-xs text-slate-400">Version {item.version_name||'automatically detected'}</span>}
      <div className="mt-auto flex flex-wrap gap-2">{manager && !item.school_id && <HubItemAction id={item.id} action={enabled.has(item.id) ? "disable" : "enable"}>{enabled.has(item.id) ? "Enabled for school · disable" : "Enable for this school"}</HubItemAction>}
      {previewUrls.get(item.storage_path) && <a className="btn-secondary" href={previewUrls.get(item.storage_path) || undefined} target="_blank" rel="noreferrer">View file</a>}
      {manager && (staff.role === "super_admin" || item.school_id === school.id) && <HubItemAction id={item.id} action="publish">{item.published ? "Withdraw" : "Republish"}</HubItemAction>}</div>
    </article>)}</div>}
    {kind!=='resource'&&!items?.length && !error && <div className="card p-12 text-center"><h2 className="text-xl font-semibold">Your library starts here</h2><p className="mt-2 text-slate-500">Publish a file above. Shared items reach students only after their school enables them.</p></div>}
  </section>;
}
