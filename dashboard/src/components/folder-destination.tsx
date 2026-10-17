"use client";
import {useState} from "react";
import {Folder,ChevronRight,ArrowLeft,Check,Search} from "lucide-react";

export function FolderDestination({paths,value,onChange,name,disabled=false}:{paths:string[][];value:string;onChange?:(value:string)=>void;name?:string;disabled?:boolean}){
 const [query,setQuery]=useState(''),[parent,setParent]=useState<string[]>([]),[local,setLocal]=useState(value);
 const selected=onChange?value:local;
 const all=[...new Map(paths.flatMap(p=>p.map((_,n)=>p.slice(0,n+1))).map(p=>[JSON.stringify(p),p])).values()];
 const matches=all.filter(p=>p.length===parent.length+1&&parent.every((v,n)=>p[n]===v)&&p[p.length-1].toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>a.at(-1)!.localeCompare(b.at(-1)!));
 function choose(p:string[]){const next=JSON.stringify(p);setLocal(next);onChange?.(next);setParent(p);setQuery('');}
 return <div className="min-w-64 space-y-2 text-xs"><span className="label">Destination</span>{name&&<input type="hidden" name={name} value={selected}/>}
 <div className="flex flex-wrap items-center gap-1"><button type="button" disabled={disabled} className="text-brand-700" onClick={()=>{setParent([]);setQuery('');}}>School notes</button>{parent.map((part,n)=><span className="flex items-center gap-1" key={n}><ChevronRight size={12}/><button type="button" disabled={disabled} onClick={()=>{setParent(parent.slice(0,n+1));setQuery('');}}>{part}</button></span>)}</div>
 <label className="input flex items-center gap-2"><Search size={14}/><input aria-label="Search destination folders" placeholder={parent.length?'Search subfolders...':'Type a folder name, e.g. robo'} className="min-w-0 flex-1 bg-transparent outline-none" disabled={disabled} value={query} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(matches[0])choose(matches[0]);}if(e.key==='Escape'){setQuery('');}}} onChange={e=>setQuery(e.target.value)}/></label>
 <div className="max-h-44 overflow-auto rounded-lg border border-line bg-surface p-1">{parent.length>0&&<button type="button" disabled={disabled} className="flex w-full items-center gap-2 rounded p-2 text-muted hover:bg-panel" onClick={()=>{setParent(parent.slice(0,-1));setQuery('');}}><ArrowLeft size={13}/>Back</button>}{matches.map(p=><button type="button" disabled={disabled} key={JSON.stringify(p)} className="flex w-full items-center gap-2 rounded p-2 text-left hover:bg-brand-50" onClick={()=>choose(p)}><Folder size={15} className="text-brand-700"/><span className="flex-1">{p.at(-1)}</span>{all.some(child=>child.length===p.length+1&&p.every((v,n)=>child[n]===v))&&<ChevronRight size={13}/>}</button>)}{!matches.length&&<p className="p-2 text-muted">{query?'No matching folders here.':'No subfolders. You can use this folder.'}</p>}</div>
 {selected&&<p className="flex items-center gap-1 text-brand-700" role="status"><Check size={13}/>Destination: {(JSON.parse(selected) as string[]).join(' / ')}</p>}
 </div>;
}
