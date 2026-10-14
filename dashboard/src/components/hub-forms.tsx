"use client";
import { useActionState, useState } from "react";
import { publishItem, changeLibraryItem, saveHubSettings, reviewAppRequest } from "@/app/(app)/library/actions";
import { createClient } from "@/lib/supabase/browser";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";
import type { FormState } from "@/lib/types";

export function HubUpload({ kind, schoolId, superAdmin, folder=[] }: { kind: string; schoolId: string; superAdmin: boolean; folder?:string[] }) {
  const [state, setState] = useState<FormState>(); const [busy, setBusy] = useState(false);
  const [selected,setSelected]=useState<string[]>([]),[progress,setProgress]=useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const files = (data.getAll("file") as File[]).filter(f=>f.size);
    if (!files.length) return setState({ error: "Choose a file." });
    if(files.length>50)return setState({error:'Upload at most 50 resources at a time.'});
    if (kind === "wallpaper" && files.some(file=>file.size > 8_000_000)) return setState({ error: "Wallpapers must be smaller than 8 MB." });
    const shared = data.get("shared") === "on";
    setBusy(true); setState(undefined);
    try {
      const supabase = createClient();
      let completed=0;
      for(const file of files) {
      const path = `${shared ? "shared" : schoolId}/${crypto.randomUUID()}/${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      setProgress(`Uploading ${completed+1} of ${files.length}: ${file.name}`);
      const { error } = await supabase.storage.from("primesecure-hub").upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (error) throw error;
      const result = await publishItem({ kind, path, shared, title: kind==='app'?String(data.get('title')||''):(files.length>1?file.name:String(data.get("title")||file.name)).slice(0,160), description: String(data.get("description") || ""), form: String(data.get("form") || ""), subject: String(data.get("subject") || ""), category: String(data.get("category") || "Notes"), size: file.size, mime: file.type || "application/octet-stream", preinstall: data.get("preinstall") === "on" });
      if (result?.error) await supabase.storage.from("primesecure-hub").remove([path]);
      if(result?.error)throw new Error(`${completed} files published. ${result.error}`);
      completed++;
      }
      setState({ok:`${completed} ${completed===1?'file':'files'} published to the library.`});form.reset();setSelected([]);
    } catch (e) { setState({ error: e instanceof Error ? e.message : "Upload failed." }); } finally { setBusy(false);setProgress(''); }
  }
  return <form onSubmit={submit} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const input=e.currentTarget.querySelector<HTMLInputElement>('input[type=file]');if(input&&e.dataTransfer.files.length){input.files=e.dataTransfer.files;setSelected(Array.from(input.files).map(f=>f.name));}}} className="grid gap-4 md:grid-cols-2">
    <label className="label">{kind==="app"?"Display name (optional)":"Title (optional)"}<input name="title" maxLength={160} className="input mt-1" placeholder={kind === "resource" ? "Use the filename, or enter a title" : kind==="app"?"Automatically detected from your APK":"Name students will see"} /></label>
    <label className="label rounded-xl border border-dashed border-brand-100 bg-brand-50/50 p-4">{kind==='resource'?'Drop files here or choose multiple resources':kind==='app'?'Drop an APK here or choose your APK':'Choose your file'}<input name="file" type="file" multiple={kind==='resource'} required onChange={e=>setSelected(Array.from(e.target.files||[]).map(f=>f.name))} accept={kind === "app" ? ".apk" : kind === "wallpaper" ? "image/png,image/jpeg,image/webp" : undefined} className="input mt-2" />{selected.length>0&&<span className="mt-2 block text-xs text-brand-600">{selected.length} selected: {selected.slice(0,3).join(', ')}{selected.length>3?'…':''}</span>}</label>
    <label className="label md:col-span-2">Description<textarea name="description" maxLength={2000} className="input mt-1" rows={2} /></label>
    {kind === "resource" && <><label className="label">Form<select name="form" defaultValue={folder[0]||'Form 1'} className="input mt-1">{[1,2,3,4,5,6].map(n => <option key={n}>Form {n}</option>)}<option>All levels</option></select></label><label className="label">Subject<input name="subject" defaultValue={folder[1]||''} required placeholder="Mathematics" maxLength={100} className="input mt-1" /></label><label className="label">Resource folder<select name="category" defaultValue={folder[2]||'Notes'} className="input mt-1">{["Notes", "Past exam papers", "Textbooks", "Images", "Videos", "Other resources"].map(c => <option key={c}>{c}</option>)}</select></label></>}
    {kind === "app" && <><div className="rounded-xl bg-brand-50 p-4 text-sm text-brand-700">Just choose the APK. PrimeSecure reads its name, version, icon and application identifier automatically.</div><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="preinstall" /> Automatically install on enrolled devices</label></>}
    {superAdmin && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="shared" /> Shared RoboKorda library (schools opt in)</label>}
    <div className="flex flex-wrap items-center gap-4 md:col-span-2"><button className="btn-primary" disabled={busy}>{busy ? "Uploading…" : "Publish to library"}</button>{progress&&<span className="text-xs text-slate-400" role="status">{progress}</span>}<FormMessage state={state} /></div>
  </form>;
}

export function HubItemAction({ id, action, children }: { id: string; action: string; children: React.ReactNode }) {
  const [state, run] = useActionState(changeLibraryItem, undefined);
  return <form action={run}><input type="hidden" name="id" value={id} /><input type="hidden" name="action" value={action} /><SubmitButton className="btn-secondary">{children}</SubmitButton><FormMessage state={state} /></form>;
}
export type HubSettings = { default_wallpaper_id: string | null; allow_wallpaper_choice: boolean; hide_vendor_store: boolean };
export function HubSettingsForm({ wallpapers, settings, global = false }: { wallpapers: {id: string; title: string}[]; settings: HubSettings | null; global?: boolean }) {
  const [state, action] = useActionState(saveHubSettings, undefined);
  return <form action={action} className="space-y-4">
    {global && <input type="hidden" name="global" value="on" />}
    <label className="label">Default wallpaper<select name="wallpaper" defaultValue={settings?.default_wallpaper_id || ""} className="input mt-1"><option value="">{global ? "Use existing device wallpaper policy" : "Inherit master wallpaper"}</option>{wallpapers.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}</select></label>
    <label className="flex gap-2 text-sm"><input name="allow_choice" type="checkbox" defaultChecked={settings?.allow_wallpaper_choice ?? true} /> Let students choose approved wallpapers</label>
    <label className="flex gap-2 text-sm"><input name="hide_vendor_store" type="checkbox" defaultChecked={settings?.hide_vendor_store ?? false} /> Hide Primebook App Store and block outside APK installs</label>
    <SubmitButton>Save {global ? "master" : "school"} defaults</SubmitButton><FormMessage state={state} />
  </form>;
}
export function ReviewRequest({ id, status }: { id: string; status: string }) {
  const [state, action] = useActionState(reviewAppRequest, undefined);
  return <form action={action} className="flex flex-wrap gap-2"><input type="hidden" name="id" value={id} /><select name="status" defaultValue={status === "requested" ? "reviewing" : status} className="input w-auto"><option value="reviewing">Reviewing</option><option value="approved">Approved</option><option value="declined">Declined</option></select><SubmitButton>Save</SubmitButton><FormMessage state={state} /></form>;
}
