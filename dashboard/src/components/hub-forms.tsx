"use client";
import { useActionState, useRef, useState } from "react";
import { folderUploadOptions } from '@/lib/folder-upload';
import { LIBRARY_MAX_BYTES, MAX_UPLOAD_SELECTION } from '@/lib/upload-limits';
import { Trash2 } from "lucide-react";
import { changeLibraryItem, saveHubSettings, reviewAppRequest } from "@/app/(app)/library/actions";
import { useUploads } from "./upload-queue";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";
import type { FormState } from "@/lib/types";

export function HubUpload({ kind, schoolId, superAdmin, folder=[],forms=[] }: { kind: string; schoolId: string; superAdmin: boolean; folder?:string[];forms?:string[] }) {
  const uploads=useUploads();
  const fileInput=useRef<HTMLInputElement>(null);
  const queuedSelection=useRef(new Set<string>());
  const fileKey=(file:File)=>JSON.stringify([file.webkitRelativePath,file.name,file.size,file.lastModified]);
  const [directory,setDirectory]=useState(false);
  const [state,setState]=useState<FormState>(),[busy,setBusy]=useState(false),[selected,setSelected]=useState<string[]>([]);
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();const form=event.currentTarget,data=new FormData(form),files=Array.from(fileInput.current?.files||[]).filter(file=>!queuedSelection.current.has(fileKey(file)));
    setBusy(true);setState(undefined);
    let queued=0;
    try{
      const options={kind,shared:data.get('shared')==='on',title:String(data.get('title')||''),description:String(data.get('description')||''),form:directory?folder[0]||'':String(data.get('form')||''),subject:directory?folder[1]||'':String(data.get('subject')||''),category:directory?folder[2]||'':String(data.get('category')??'Notes'),preinstall:data.get('preinstall')==='on'};
      if(!files.length)throw new Error('Choose files or a folder first.');
      if(files.some(file=>!file.size||file.size>LIBRARY_MAX_BYTES))throw new Error('Every file must be non-empty and 500 MB or less.');
      files.forEach(file=>folderUploadOptions(file,options));
      if(!directory&&files.length>MAX_UPLOAD_SELECTION)throw new Error('Choose up to 100 files, or use Upload folder for a larger folder.');
      for(let offset=0;offset<files.length;offset+=MAX_UPLOAD_SELECTION){
        const batch=files.slice(offset,offset+MAX_UPLOAD_SELECTION);
        await uploads.enqueue(batch,schoolId,options);batch.forEach(file=>queuedSelection.current.add(fileKey(file)));queued+=batch.length;
      }
      setState({ok:`${files.length} ${files.length===1?'file added':'files added'} to Background uploads. You can continue using the dashboard.`});form.reset();setSelected([]);
    }catch(error){setState({error:(queued?`${queued} files already queued; the remaining files were not queued. `:'')+(error instanceof Error?error.message:'Could not queue the selected files.')});}finally{setBusy(false);}
  }
  return <form onSubmit={submit} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const input=e.currentTarget.querySelector<HTMLInputElement>('input[type=file]');if(input&&e.dataTransfer.files.length){input.files=e.dataTransfer.files;queuedSelection.current.clear();setSelected(Array.from(input.files).map(f=>f.name));}}} className="grid gap-4 md:grid-cols-2">
    <label className="label">{kind==="app"?"Display name (optional)":"Title (optional)"}<input name="title" maxLength={160} className="input mt-1" placeholder={kind === "resource" ? "Use the filename, or enter a title" : kind==="app"?"Automatically detected from your APK":"Name students will see"} /></label>
    <div className="label rounded-xl border border-dashed border-brand-100 bg-brand-50/50 p-4">{kind==='resource'&&<label className="mb-2 flex items-center gap-2"><input type="checkbox" checked={directory} onChange={e=>{setDirectory(e.target.checked);queuedSelection.current.clear();setSelected([]);}}/>Upload a whole folder</label>}<label>{directory?'Choose a folder; its subfolders and files are preserved':kind==='resource'?'Drop files here or choose up to 100 resources':kind==='app'?'Drop APKs here or choose up to 100 APKs':kind==='media'?'Choose music or video files':'Drop wallpapers here or choose multiple images'}<input key={String(directory)} ref={node=>{fileInput.current=node;if(node)node.webkitdirectory=directory;}} name="file" type="file" multiple required onChange={e=>{queuedSelection.current.clear();setSelected(Array.from(e.target.files||[]).map(f=>f.webkitRelativePath||f.name));}} accept={kind === "app" ? ".apk" : kind === "wallpaper" ? "image/png,image/jpeg,image/webp" : kind==="media"?".mp3,.m4a,.ogg,.wav,.mp4,.webm":undefined} className="input mt-2" />{selected.length>0&&<span className="mt-2 block text-xs text-brand-600">{selected.length} selected: {selected.slice(0,3).join(', ')}{selected.length>3?'...':''}</span>}<span className="mt-1 block text-[10px] text-muted">{kind==='wallpaper'?'Maximum 8 MB per wallpaper.':'Maximum 500 MB per file.'} {directory?'Queues larger folders in batches of 100. Empty folders cannot be read by the browser. Three folder levels are supported.':'Up to 100 files per selection.'}</span></label></div>
    <label className="label md:col-span-2">Description<textarea name="description" maxLength={2000} className="input mt-1" rows={2} /></label>
    {kind === "resource" && (directory?<p className="text-xs text-muted md:col-span-2">Folder destination: {folder.join(' / ')||'School notes'}. The selected folder is added here, retaining its name.</p>:<><label className="label">Form<select name="form" defaultValue={folder[0]||forms[0]||'All levels'} className="input mt-1">{[...new Set([...forms,...(folder[0]?[folder[0]]:[])])].map(f => <option key={f}>{f}</option>)}<option>All levels</option></select></label><label className="label">Subject<input name="subject" defaultValue={folder[1]||''} required placeholder="Mathematics" maxLength={100} className="input mt-1" /></label><label className="label">Resource folder<select name="category" defaultValue={folder.length===2?'':folder[2]||'Notes'} className="input mt-1"><option value="">Directly in this folder</option>{[...new Set([...(folder[2]?[folder[2]]:[]),"Notes", "Past exam papers", "Textbooks", "Images", "Videos", "Other resources"])].map(c => <option key={c}>{c}</option>)}</select></label></>)}
    {kind === "media" && <label className="label">Category<select name="category" className="input mt-1"><option>Learning</option><option>Music</option><option>Robotics</option><option>Science</option><option>Languages</option><option>Other</option></select></label>}
    {kind === "app" && <><div className="rounded-xl bg-brand-50 p-4 text-sm text-brand-700">Just choose the APK. PrimeSecure reads its name, version, icon and application identifier automatically.</div><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="preinstall" /> Automatically install on enrolled devices</label></>}
    {superAdmin && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="shared" /> {kind === "wallpaper" ? "Shared wallpaper gallery (available to all schools)" : "Shared RoboKorda library (schools opt in)"}</label>}
    <div className="flex flex-wrap items-center gap-4 md:col-span-2"><button className="btn-primary" disabled={busy||!uploads.ready}>{busy ? "Saving files..." : "Upload files"}</button><button type="button" className="text-xs text-brand-700" onClick={()=>uploads.setOpen(true)}>View background uploads</button><FormMessage state={state} /></div>
  </form>;
}

export function HubItemAction({ id, action, children }: { id: string; action: string; children: React.ReactNode }) {
  const [state, run] = useActionState(changeLibraryItem, undefined);
  return <form action={run}><input type="hidden" name="id" value={id} /><input type="hidden" name="action" value={action} /><SubmitButton className="btn-secondary">{children}</SubmitButton><FormMessage state={state} /></form>;
}
export function DeleteHubAppButton({ id }: { id: string }) {
  const [state, run] = useActionState(changeLibraryItem, undefined);
  return <form action={run} onSubmit={event => { if (!window.confirm("Delete this app from the App Store? Devices that already installed it will keep their copy.")) event.preventDefault(); }}>
    <input type="hidden" name="id" value={id} /><input type="hidden" name="action" value="delete" />
    <SubmitButton className="btn-secondary text-red-700"><Trash2 size={12} />Delete app</SubmitButton><FormMessage state={state} />
  </form>;
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
