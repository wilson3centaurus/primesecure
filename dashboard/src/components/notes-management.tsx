"use client";

import { useActionState, useState } from "react";
import { FolderPlus, Pencil, Trash2, Copy, FolderInput } from "lucide-react";
import { manageNotesFolder, organiseNoteFile } from "@/app/(app)/library/actions";
import { SubmitButton } from "./submit-button";
import { FormMessage } from "./form-message";

export type NotesFolder={path:string[];school_id:string|null};

export function NotesFolderTools({path,superAdmin,onSaved,folders,defaultShared=false}:{path:string[];superAdmin:boolean;folders:string[][];defaultShared?:boolean;onSaved:(path:string[])=>void}) {
 const [open,setOpen]=useState(false),[mode,setMode]=useState('create'),[shared,setShared]=useState(defaultShared);
 const destinations=[...new Map(folders.filter(p=>p.length===path.length-1&&p.some((v,n)=>v!==path[n])).map(p=>[JSON.stringify(p),p])).values()];
 const [state,action]=useActionState(async(prev:Parameters<typeof manageNotesFolder>[0],data:FormData)=>{
  const result=await manageNotesFolder(prev,data);
  if(result?.ok){const next=mode==='create'?[...path.slice(0,2),String(data.get('name')||'').trim()]:mode==='rename'?[...path.slice(0,-1),String(data.get('name')||'').trim()]:mode==='move'?JSON.parse(String(data.get('target'))):path.slice(0,-1);onSaved(next);}
  return result;
 },undefined);
 return <details className="border-b border-line bg-panel px-4 py-3" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary className="cursor-pointer text-xs font-semibold text-brand-700">Folder actions: Create, rename, move or delete</summary><form action={action} onReset={e=>e.preventDefault()} className="mt-3 flex flex-wrap items-end gap-3" onSubmit={e=>{if(mode==='delete'&&!confirm(`Delete this empty folder and its empty subfolders? Files are never deleted here.`))e.preventDefault();}}>
  <input type="hidden" name="action" value={mode}/><input type="hidden" name="path" value={JSON.stringify(mode==='create'?[...path.slice(0,2),'__new__']:path)}/>
  <label className="label">Action<select className="input mt-1" value={mode} onChange={e=>setMode(e.target.value)}><option value="create">Create folder</option>{path.length>0&&<><option value="rename">Rename this folder</option>{path.length>1&&<option value="move">Move this folder</option>}<option value="delete">Delete this empty folder</option></>}</select></label>
  {superAdmin&&<label className="label">Library<select className="input mt-1" value={shared?'shared':'school'} onChange={e=>setShared(e.target.value==='shared')}><option value="school">This school</option><option value="shared">RoboKorda shared</option></select></label>}
  {shared&&<input type="hidden" name="shared" value="on"/>}
  {mode==='move'&&<label className="label">Destination parent<select className="input mt-1" name="target" required defaultValue=""><option value="" disabled>Choose a folder</option>{destinations.map(p=><option key={JSON.stringify(p)} value={JSON.stringify([...p,path[path.length-1]])}>{p.join(' / ')}</option>)}</select></label>}
  {mode!=='delete'&&mode!=='move'&&<label className="label">{mode==='create'?path.length===0?'Form folder':path.length===1?'Subject folder':'Resource folder':'New name'}<input className="input mt-1" name="name" required maxLength={path.length===1?100:80} placeholder="Folder name"/></label>}
  <SubmitButton className="btn-secondary">{mode==='create'?<FolderPlus size={13}/>:mode==='rename'?<Pencil size={13}/>:mode==='move'?<FolderInput size={13}/>:<Trash2 size={13}/>}Save</SubmitButton><FormMessage state={state}/>
  <p className="w-full text-[11px] text-muted">{mode==='move'?'Moves this folder, its subfolders and resources within the selected library. Create the destination parent first.':mode==='delete'?'Move files out first. Deleting an empty folder also removes its empty subfolders.':mode==='rename'?'Renames this folder and organises the resources inside it.':'Folders use Form / Subject / Resource folder. At the deepest level, a new folder sits beside the current one.'}</p>
 </form></details>;
}

export function NotesFileTools({id,current,destinations,canMove}:{id:string;current:string[];destinations:string[][];canMove:boolean}) {
 const [state,action]=useActionState(organiseNoteFile,undefined);
 const choices=[...new Map([current,...destinations].filter(p=>p.length===3).map(p=>[JSON.stringify(p),p])).values()].sort((a,b)=>a.join('/').localeCompare(b.join('/')));
 return <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium text-brand-700">Move or copy</summary><form action={action} onReset={e=>e.preventDefault()} className="mt-2 space-y-2"><input type="hidden" name="id" value={id}/><label className="label">Destination<select className="input mt-1 text-xs" name="target" defaultValue={JSON.stringify(current)}>{choices.map(p=><option key={JSON.stringify(p)} value={JSON.stringify(p)}>{p.join(' / ')}</option>)}</select></label><label className="label">Action<select className="input mt-1" name="action"><option value="copy">Copy to school (keep original)</option>{canMove&&<option value="move">Move original</option>}</select></label><SubmitButton className="btn-secondary"><Copy size={12}/>Apply</SubmitButton><FormMessage state={state}/><p className="text-[10px] text-muted">Create a destination folder above first. Copy keeps the original file.</p></form></details>;
}
