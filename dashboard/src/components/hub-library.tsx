import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { HubItemAction, HubSettingsForm, HubUpload } from "./hub-forms";
import { PageHeader } from "./page-header";
import { dateTime } from "@/lib/format";
import Image from "next/image";
import { FolderLibrary } from "./folder-library";
import { AppWindow, Search, ArrowDownToLine, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import Form from "next/form";

export async function HubLibrary({ kind,settingsOnly=false,query="",page=1 }: { kind: "resource" | "wallpaper" | "app";settingsOnly?:boolean;query?:string;page?:number }) {
  const staff = await requireStaff(); const school = await getCurrentSchool();
  if (!school) return <PageHeader title="Student library" description="Create a school first." />;
  const supabase = await createClient();
  const [{ data: rows, error }, { data: access }, { data: settings },{data:groups}] = await Promise.all([
    supabase.from("hub_items").select("id,title,description,package_name,version_name,size,published,school_id,preinstall,storage_path,source_url,created_at,form_level,subject,category,mime_type").eq("kind", kind).or(`school_id.is.null,school_id.eq.${school.id}`).order("created_at", { ascending: false }),
    supabase.from("hub_access").select("item_id").eq("school_id", school.id),
    kind==='wallpaper'?supabase.from("hub_settings").select("*").or(`scope.eq.global,school_id.eq.${school.id}`):Promise.resolve({data:[]}),
    kind==='resource'?supabase.from("school_classes").select("form_level,class_name").eq("school_id",school.id):Promise.resolve({data:[]}),
  ]);
  type Item={id:string;title:string;description:string;package_name:string;version_name:string;size:number;published:boolean;school_id:string|null;preinstall:boolean;storage_path:string;source_url:string|null;created_at:string;form_level:string;subject:string;category:string;icon_data?:string;mime_type?:string};
  const items=(rows??[]) as Item[];
  const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean),matches=items.filter(item=>terms.every(term=>`${item.title} ${item.description} ${item.package_name||''} ${item.version_name||''} ${item.storage_path}`.toLowerCase().includes(term)));
  const pages=Math.max(1,Math.ceil(matches.length/24)),currentPage=Math.min(pages,Math.max(1,Number.isFinite(page)?Math.trunc(page):1));
  const displayed=kind==='app'?matches.slice((currentPage-1)*24,currentPage*24):items;
  const {data:icons}=kind==='app'&&displayed.length?await supabase.from('hub_items').select('id,icon_data').in('id',displayed.map(item=>item.id)):{data:[]};
  const iconData=new Map((icons||[]).map(item=>[item.id,item.icon_data as string|null]));
  const manager = canManage(staff, school.id); const enabled = new Set((access || []).map(a => a.item_id));
  const { data: previews } = kind==='wallpaper'&&displayed.length ? await supabase.storage.from("primesecure-hub").createSignedUrls(displayed.map(i => i.storage_path), 600) : { data: [] };
  const previewUrls = new Map((previews || []).map(p => [p.path, p.signedUrl]));
  if(kind!=='wallpaper')displayed.forEach(item=>previewUrls.set(item.storage_path,`/api/hub-download/${item.id}`));
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
    {kind==='resource'&&<FolderLibrary items={(items||[]).map(i=>({...i,mime:i.mime_type,url:previewUrls.get(i.storage_path)||undefined}))} schoolId={school.id} superAdmin={staff.role==='super_admin'} manager={manager} enabled={[...enabled]} forms={[...new Set((groups||[]).map(g=>g.form_level))]}/>}
    {kind==='wallpaper'&&manager && <details className="card p-5"><summary className="cursor-pointer font-semibold text-brand-700">+ Publish a wallpaper</summary><div className="pt-5"><HubUpload kind={kind} schoolId={school.id} superAdmin={staff.role === "super_admin"} /></div></details>}
    {kind==='app'&&<><Form key={query} className="card flex flex-wrap items-center gap-3 p-3" action="/apps" scroll={false}><input type="hidden" name="tab" value="store"/><label className="flex min-w-48 flex-1 items-center gap-2"><Search size={15} className="text-muted"/><input name="q" defaultValue={query} aria-label="Search approved apps" placeholder="Search name, version, package or description..." className="w-full min-w-0 bg-transparent text-xs outline-none"/></label><span className="text-xs text-muted">{matches.length} apps</span><button className="btn-secondary">Search</button>{query&&<Link className="text-xs text-brand-700" href="/apps">Clear</Link>}</Form><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{displayed.map(item=><article key={item.id} className="app-list-card">
      <div className="app-list-icon text-brand-500">{iconData.get(item.id)?<Image unoptimized src={iconData.get(item.id)!} alt={item.title} width={58} height={58} className="size-full object-contain"/>:<AppWindow size={26}/>}</div>
      <div className="min-w-0 flex-1"><h2 className="text-xs font-semibold leading-5 text-ink">{item.title}</h2><p className="mt-1 text-[11px] text-muted">{[item.version_name,(item.size/1048576).toFixed(1)+' MB'].filter(Boolean).join(' · ')}</p><p className={`mt-1.5 text-[10px] font-medium ${item.published&&(item.school_id||enabled.has(item.id))?'text-emerald-700':'text-muted'}`}>{item.published&&(item.school_id||enabled.has(item.id))?'Approved':'Not available'}{item.preinstall?' · Required install':''}</p>
      <details className="mt-2 text-xs"><summary className="flex cursor-pointer list-none items-center gap-1 text-muted"><MoreHorizontal size={14}/>Manage app</summary><p className="mt-2 break-all font-mono text-[10px] text-muted">{item.package_name}</p><div className="mt-2 flex flex-wrap gap-2">{manager&&!item.school_id&&<HubItemAction id={item.id} action={enabled.has(item.id)?'disable':'enable'}>{enabled.has(item.id)?'Disable':'Enable'}</HubItemAction>}{previewUrls.get(item.storage_path)&&<a className="btn-secondary" href={previewUrls.get(item.storage_path)||undefined} target="_blank" rel="noreferrer"><ArrowDownToLine size={12}/>APK</a>}{item.source_url&&<a className="btn-secondary" href={item.source_url} target="_blank" rel="noreferrer">Source</a>}{manager&&(staff.role==='super_admin'||item.school_id===school.id)&&<HubItemAction id={item.id} action="publish">{item.published?'Withdraw':'Republish'}</HubItemAction>}</div></details></div>
    </article>)}</div>{!displayed.length&&query&&<div className="card py-10 text-center"><Search size={22} className="mx-auto mb-3 text-muted"/><p className="text-sm font-medium">No matching apps</p><p className="mt-2 text-xs text-muted">Try a name, version or application package.</p></div>}{pages>1&&<nav aria-label="App library pages" className="flex items-center justify-between text-xs text-muted"><span>Page {currentPage} of {pages} · 24 per page</span><div className="flex gap-2">{currentPage>1&&<Link className="btn-secondary" href={{pathname:'/apps',query:{q:query,page:currentPage-1}}}>Previous</Link>}{currentPage<pages&&<Link className="btn-secondary" href={{pathname:'/apps',query:{q:query,page:currentPage+1}}}>Next</Link>}</div></nav>}</>}
    {kind==='wallpaper'&&<div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{(items||[]).map(item=><article key={item.id} className="card overflow-hidden">{previewUrls.get(item.storage_path)&&<Image unoptimized src={previewUrls.get(item.storage_path)!} alt={item.title} width={800} height={450} className="aspect-video w-full object-cover"/>}<div className="space-y-3 p-4"><h2 className="text-sm font-semibold">{item.title}</h2><p className="text-xs text-slate-500">{(item.size/1048576).toFixed(1)} MB · {dateTime(item.created_at)}</p><div className="flex flex-wrap gap-2">{manager&&!item.school_id&&<HubItemAction id={item.id} action={enabled.has(item.id)?'disable':'enable'}>{enabled.has(item.id)?'Disable for school':'Enable for school'}</HubItemAction>}{manager&&(staff.role==='super_admin'||item.school_id===school.id)&&<HubItemAction id={item.id} action="publish">{item.published?'Withdraw':'Republish'}</HubItemAction>}</div></div></article>)}</div>}
    {kind!=='resource'&&!items?.length && !error && <div className="card p-12 text-center"><h2 className="text-xl font-semibold">Your library starts here</h2><p className="mt-2 text-slate-500">Publish a file above. Shared items reach students only after their school enables them.</p></div>}
  </section>;
}
