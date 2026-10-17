"use client";
import {useState,useTransition} from "react";
import {CheckSquare,Copy,FolderInput,LoaderCircle,X} from "lucide-react";
import {bulkNotes} from "@/app/(app)/library/bulk-actions";
import {FormMessage} from "./form-message";
import type {LibraryFile} from "./folder-library";

export function NotesBulkTools({items,schoolId,superAdmin,destinations,onCompleted,onClear}:{items:LibraryFile[];schoolId:string;superAdmin:boolean;destinations:string[][];onCompleted:(ids:string[])=>void;onClear:()=>void}){
 const [action,setAction]=useState('copy'),[target,setTarget]=useState(''),[pending,startTransition]=useTransition(),[state,setState]=useState<{ok?:string;error?:string}>();
 if(!items.length)return state?<div className="border-b border-line px-4 py-3"><FormMessage state={state}/></div>:null;
 const shared=items.length>0&&items.every(i=>i.school_id===null),editable=items.every(i=>i.school_id===schoolId||superAdmin&&i.school_id===null);
 const choices=[...new Map(destinations.map(p=>[JSON.stringify(p),p])).values()].sort((a,b)=>a.join('/').localeCompare(b.join('/')));
 const needsFolder=action==='move'||action==='copy',allowed=items.length>0&&(!['move','publish','withdraw'].includes(action)||editable)&&(!['enable','disable'].includes(action)||shared);
 return <section className="border-b border-line bg-brand-50 px-4 py-3" aria-label="Selected notes actions"><div className="flex flex-wrap items-center gap-2"><CheckSquare size={15} className="text-brand-700"/><strong className="text-xs text-ink" role="status">{items.length} selected</strong><button className="ml-auto flex items-center gap-1 text-xs text-muted" onClick={onClear} disabled={pending}><X size={13}/>Clear selection</button></div>
 <form onSubmit={event=>{event.preventDefault();if(!allowed||pending)return;if(action==='withdraw'&&!confirm(`Withdraw ${items.length} selected files? Shared originals are withdrawn for every school using them.`))return;const selected=items.map(i=>i.id);startTransition(async()=>{setState(undefined);try{const result=await bulkNotes({schoolId,ids:selected,action,target:needsFolder?JSON.parse(target):undefined});setState(result);onCompleted(result.completed);}catch{setState({error:'The result could not be confirmed. Refresh the library before retrying.'});}});}} className="mt-3 flex flex-wrap items-end gap-2">
 <label className="label text-xs">Bulk action<select className="input mt-1 text-xs" aria-label="Bulk notes action" value={action} disabled={pending} onChange={e=>{setAction(e.target.value);setState(undefined);}}><option value="copy">Copy into this school</option><option value="move" disabled={!editable}>Move originals</option><option value="enable" disabled={!shared}>Enable for this school</option><option value="disable" disabled={!shared}>Disable for this school</option><option value="withdraw" disabled={!editable}>Withdraw from students</option><option value="publish" disabled={!editable}>Republish</option></select></label>
 {needsFolder&&<label className="label min-w-48 text-xs">Destination<select aria-label="Bulk destination folder" className="input mt-1 text-xs" required value={target} disabled={pending} onChange={e=>setTarget(e.target.value)}><option value="">Choose a folder</option>{choices.map(p=><option key={JSON.stringify(p)} value={JSON.stringify(p)}>{p.join(' / ')}</option>)}</select></label>}
 <button className="btn-primary" disabled={pending||!allowed||needsFolder&&!target}>{pending?<LoaderCircle size={13} className="animate-spin"/>:action==='copy'?<Copy size={13}/>:<FolderInput size={13}/>} {pending?'Applying...':'Apply to selected'}</button><FormMessage state={state}/>
 </form><p className="mt-2 text-[11px] text-muted">{pending?'Keep this page open until the operation finishes.':!editable?'Shared originals are managed by RoboKorda; copy them to organise your own school library.':'Move and copy keep the destination folder structure. Withdraw keeps the files in your library.'}</p></section>;
}
