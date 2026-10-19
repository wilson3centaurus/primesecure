"use client";
import { useActionState, useRef, useState } from "react";
import { folderUploadOptions } from '@/lib/folder-upload';
import { LIBRARY_MAX_BYTES, MAX_UPLOAD_SELECTION } from '@/lib/upload-limits';
import { groupApkFolders, packApkFolder } from '@/lib/apk-folder';
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
  const submitting=useRef(false);
  const fileKey=(file:File)=>JSON.stringify([file.webkitRelativePath,file.name,file.size,file.lastModified]);
  const [directory,setDirectory]=useState(false);
  const appFolder=kind==='app'&&directory;
  const [packing,setPacking]=useState('');
  const [state,setState]=useState<FormState>(),[busy,setBusy]=useState(false),[selected,setSelected]=useState<string[]>([]);
  function clearSelection(){
    queuedSelection.current.clear();setSelected([]);setState(undefined);
    if(fileInput.current)fileInput.current.value='';
  }
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(submitting.current)return;submitting.current=true;
    const form=event.currentTarget,data=new FormData(form),selection=Array.from(fileInput.current?.files||[]);
    setBusy(true);setState(undefined);
    let queued=0;
    try{
      const resourceFolder=kind==='resource'&&directory;
      const options={kind,shared:data.get('shared')==='on',title:String(data.get('title')||''),description:String(data.get('description')||''),form:resourceFolder?folder[0]||'':String(data.get('form')||''),subject:resourceFolder?folder[1]||'':String(data.get('subject')||''),category:resourceFolder?folder[2]||'':String(data.get('category')??'Notes'),preinstall:data.get('preinstall')==='on'};
      if(appFolder){
        // Validate the complete selection before saving any app. Retry filters
        // whole groups; filtering individual APKs would orphan their splits.
        const groups=groupApkFolders(selection).filter(group=>!group.files.every(file=>queuedSelection.current.has(fileKey(file))));
        if(!groups.length)throw new Error('These app folders are already queued. Choose another folder to upload more apps.');
        for(const [index,group] of groups.entries()){
          setPacking(`Packing app ${index+1} of ${groups.length}...`);
          const file=await packApkFolder(group.files);
          await uploads.enqueue([file],schoolId,{...options,title:groups.length>1||queuedSelection.current.size>0?'':options.title});
          group.files.forEach(original=>queuedSelection.current.add(fileKey(original)));queued++;
        }
      }else{
        const files=selection.filter(file=>!queuedSelection.current.has(fileKey(file)));
        if(!files.length)throw new Error('Choose files or a folder first.');
        if(files.some(file=>!file.size||file.size>LIBRARY_MAX_BYTES))throw new Error('Every file must be non-empty and 500 MB or less.');
        files.forEach(file=>folderUploadOptions(file,options));
        if(!directory&&files.length>MAX_UPLOAD_SELECTION)throw new Error('Choose up to 100 files, or use Upload folder for a larger folder.');
        for(let offset=0;offset<files.length;offset+=MAX_UPLOAD_SELECTION){
          const batch=files.slice(offset,offset+MAX_UPLOAD_SELECTION);
          await uploads.enqueue(batch,schoolId,options);batch.forEach(file=>queuedSelection.current.add(fileKey(file)));queued+=batch.length;
        }
      }
      form.reset();clearSelection();if(kind==='app')setDirectory(false);
      setState({ok:`${queued} ${appFolder?(queued===1?'app added':'apps added'):(queued===1?'file added':'files added')} to Background uploads. You can continue using the dashboard.`});
    }catch(error){setState({error:(queued?`${queued} ${appFolder?(queued===1?'app':'apps'):(queued===1?'file':'files')} already queued; retrying this selection skips them. `:'')+(error instanceof Error?error.message:'Could not queue the selected files.')});}finally{submitting.current=false;setBusy(false);setPacking('');}
  }
  function drop(event:React.DragEvent<HTMLFormElement>){
    event.preventDefault();if(submitting.current)return;
    const hasFolder=Array.from(event.dataTransfer.items||[]).some(item=>item.webkitGetAsEntry?.()?.isDirectory);
    if(kind==='app'&&(appFolder||hasFolder)){
      setState({error:'Use Upload app folder (base + splits) and the folder picker. Folder drops cannot reliably preserve the APK groups.'});return;
    }
    const input=fileInput.current;
    if(input&&event.dataTransfer.files.length){
      input.files=event.dataTransfer.files;queuedSelection.current.clear();setState(undefined);setSelected(Array.from(input.files).map(f=>f.name));
    }
  }
  return <form onSubmit={submit} onDragOver={e=>e.preventDefault()} onDrop={drop} className="grid gap-4 md:grid-cols-2">
    <label className="label">{kind==="app"?"Display name (optional)":"Title (optional)"}<input name="title" maxLength={160} className="input mt-1" placeholder={kind === "resource" ? "Use the filename, or enter a title" : kind==="app"?"Automatically detected from your APK":"Name students will see"} /></label>
    <div className="label rounded-xl border border-dashed border-brand-100 bg-brand-50/50 p-4">
      {(kind==='resource'||kind==='app')&&<label className="mb-2 flex items-center gap-2"><input type="checkbox" checked={directory} disabled={busy} onChange={e=>{setDirectory(e.target.checked);clearSelection();}}/>{kind==='app'?'Upload app folder (base + splits)':'Upload a whole folder'}</label>}
      <label>{appFolder?'Choose one app folder or a parent containing up to 100 app folders':directory?'Choose a folder; its subfolders and files are preserved':kind==='resource'?'Drop files here or choose up to 100 resources':kind==='app'?'Drop APK or PrimeSecure .psapk files here, or choose up to 100 apps':kind==='media'?'Choose music or video files':'Drop wallpapers here or choose multiple images'}
        <input key={String(directory)} ref={node=>{fileInput.current=node;if(node)node.webkitdirectory=directory;}} name="file" type="file" multiple required disabled={busy} onChange={e=>{queuedSelection.current.clear();setState(undefined);setSelected(Array.from(e.target.files||[]).map(f=>f.webkitRelativePath||f.name));}} accept={appFolder?undefined:kind === "app" ? ".apk,.psapk" : kind === "wallpaper" ? "image/png,image/jpeg,image/webp" : kind==="media"?".mp3,.m4a,.ogg,.wav,.mp4,.webm":undefined} className="input mt-2" />
        {selected.length>0&&<span className="mt-2 block text-xs text-brand-600">{selected.length} selected: {selected.slice(0,3).join(', ')}{selected.length>3?'...':''}</span>}
        <span className="mt-1 block text-[10px] text-muted">{appFolder?'Each app needs base.apk and its splits together, with 1–100 APKs. Maximum 500 MB of APKs and 500 MB including ZIP headers per app. Non-APK sidecars are ignored; OBB files are rejected.':`${kind==='wallpaper'?'Maximum 8 MB per wallpaper.':kind==='app'?'Maximum 500 MB per app package.':'Maximum 500 MB per file.'} ${directory?'Queues larger folders in batches of 100. Empty folders cannot be read by the browser. Three folder levels are supported.':'Up to 100 files per selection.'}`}</span>
      </label>
    </div>
    <label className="label md:col-span-2">Description<textarea name="description" maxLength={2000} className="input mt-1" rows={2} /></label>
    {kind === "resource" && (directory?<p className="text-xs text-muted md:col-span-2">Folder destination: {folder.join(' / ')||'School notes'}. The selected folder is added here, retaining its name.</p>:<><label className="label">Form<select name="form" defaultValue={folder[0]||forms[0]||'All levels'} className="input mt-1">{[...new Set([...forms,...(folder[0]?[folder[0]]:[])])].map(f => <option key={f}>{f}</option>)}<option>All levels</option></select></label><label className="label">Subject<input name="subject" defaultValue={folder[1]||''} required placeholder="Mathematics" maxLength={100} className="input mt-1" /></label><label className="label">Resource folder<select name="category" defaultValue={folder.length===2?'':folder[2]||'Notes'} className="input mt-1"><option value="">Directly in this folder</option>{[...new Set([...(folder[2]?[folder[2]]:[]),"Notes", "Past exam papers", "Textbooks", "Images", "Videos", "Other resources"])].map(c => <option key={c}>{c}</option>)}</select></label></>)}
    {kind === "media" && <label className="label">Category<select name="category" className="input mt-1"><option>Learning</option><option>Music</option><option>Robotics</option><option>Science</option><option>Languages</option><option>Other</option></select></label>}
    {kind === "app" && <><div className="rounded-xl bg-brand-50 p-4 text-sm text-brand-700">PrimeSecure reads app details automatically. App folders become a custom PrimeSecure .psapk ZIP with unchanged base.apk and split APKs; bundletool .apks files are unsupported. Split installs require the new PrimeSecure agent APK. Apps copied from a phone still need compatible CPU architecture (ABI) and Android versions on the target device. OBB expansion files are unsupported.</div><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="preinstall" /> Automatically install on enrolled devices</label></>}
    {superAdmin && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="shared" /> {kind === "wallpaper" ? "Shared wallpaper gallery (available to all schools)" : "Shared RoboKorda library (schools opt in)"}</label>}
    <div className="flex flex-wrap items-center gap-4 md:col-span-2" aria-live="polite"><button className="btn-primary" disabled={busy||!uploads.ready}>{busy ? packing||"Saving files..." : appFolder?"Upload app folders":"Upload files"}</button><button type="button" className="text-xs text-brand-700" onClick={()=>uploads.setOpen(true)}>View background uploads</button><FormMessage state={state} /></div>
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
