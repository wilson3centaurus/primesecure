"use client";

import { createContext,useContext,useEffect,useMemo,useRef,useState } from 'react';
import { useRouter } from 'next/navigation';
import { UploadCloud,X,Pause,Play,RotateCcw,CheckCircle2,AlertCircle,LoaderCircle } from 'lucide-react';
import { UploadQueue,type UploadJob,type UploadOptions,type UploadEntry } from '@/lib/upload-queue';
import { BrowserUploadRepository } from '@/lib/upload-repository';
import { transferUpload,publishUpload } from '@/lib/upload-transfer';
import { createClient } from '@/lib/supabase/browser';

type UploadContext={jobs:UploadJob[];ready:boolean;leader:boolean;open:boolean;setOpen:(open:boolean)=>void;enqueue:(files:File[],schoolId:string,options:UploadOptions)=>Promise<void>;pause:(id:string)=>void;retry:(id:string)=>void;remove:(id:string)=>void;error?:string};
const Context=createContext<UploadContext|null>(null);
export function useUploads(){const value=useContext(Context);if(!value)throw new Error('Upload queue is unavailable. Reload the dashboard.');return value;}

export function UploadQueueProvider({userId,schools,children}:{userId:string;schools:{id:string;name:string}[];children:React.ReactNode}){
 const router=useRouter(),engine=useRef<UploadQueue|null>(null);
 const [jobs,setJobs]=useState<UploadJob[]>([]),[ready,setReady]=useState(false),[leader,setLeader]=useState(false),[open,setOpen]=useState(false),[error,setError]=useState<string>();
 useEffect(()=>{
  let disposed=false,accountValid=true,releaseLock:(()=>void)|undefined,election:ReturnType<typeof setInterval>|undefined,refresh:ReturnType<typeof setTimeout>|undefined,claiming=false;
  const queue=new UploadQueue(userId,{
   repository:new BrowserUploadRepository(),online:()=>navigator.onLine,
   transfer:transferUpload,publish:publishUpload,
   changed:(items,message)=>{if(!disposed){setJobs(items);if(message)setError(message);}},
   completed:()=>{if(refresh)clearTimeout(refresh);refresh=setTimeout(()=>{if(!disposed)router.refresh();},750);},
  });
  engine.current=queue;
  const claim=()=>{
   if(claiming||disposed||!accountValid)return;claiming=true;
   void navigator.locks.request(`primesecure-uploads-${userId}`,{ifAvailable:true},async lock=>{
    if(!lock||disposed||!accountValid)return;
    await queue.start(true);if(disposed||!accountValid){queue.stop();return;}setLeader(true);
    await new Promise<void>(resolve=>{releaseLock=resolve;});
   }).catch(()=>{if(!disposed)setError('Could not start background uploads. Reload the dashboard.');}).finally(()=>{claiming=false;});
  };
  void (async()=>{
   await queue.start(!navigator.locks);if(disposed||!accountValid){queue.stop();return;}
   setReady(true);setLeader(!navigator.locks);
   if(navigator.locks){claim();election=setInterval(claim,5000);}
  })().catch(()=>{if(!disposed)setError('Browser storage is unavailable. Enable site storage and reload to queue files.');});
  const {data:{subscription}}=createClient().auth.onAuthStateChange((_event,session)=>{
   if(session?.user.id!==userId){accountValid=false;queue.stop();releaseLock?.();if(!disposed){setReady(false);setLeader(false);setJobs([]);setError('Uploads paused because the signed-in account changed.');}}
  });
  return()=>{disposed=true;subscription.unsubscribe();if(election)clearInterval(election);if(refresh)clearTimeout(refresh);queue.stop();releaseLock?.();engine.current=null;};
 },[userId,router]);
 const value=useMemo<UploadContext>(()=>({jobs,ready,leader,open,setOpen,error,
  enqueue:async(files,schoolId,options)=>{
   if(!ready||!engine.current)throw new Error('The upload queue is starting. Please try again.');
   if(!files.length||files.length>50)throw new Error('Choose between 1 and 50 files.');
   if(options.kind==='app'&&files.some(f=>!f.name.toLowerCase().endsWith('.apk')||f.size>250_000_000))throw new Error('Choose .apk files smaller than 250 MB.');
   if(options.kind==='wallpaper'&&files.some(f=>f.size>8_000_000||!['image/png','image/jpeg','image/webp'].includes(f.type)))throw new Error('Choose JPG, PNG or WebP wallpapers smaller than 8 MB.');
   if(files.some(f=>!f.size))throw new Error('Empty files cannot be uploaded.');
   const estimate=await navigator.storage?.estimate?.();
   if(estimate?.quota&&Number(estimate.usage||0)+files.reduce((n,f)=>n+f.size,0)>estimate.quota)throw new Error('Not enough browser storage to queue these files. Select fewer files or clear completed uploads.');
   const entries:UploadEntry[]=files.map(file=>{
    const id=crypto.randomUUID();const name=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-180);
    return {file,job:{id,ownerId:userId,schoolId,schoolName:schools.find(s=>s.id===schoolId)?.name||'School',name:file.name,mime:options.kind==='app'?'application/vnd.android.package-archive':file.type||'application/octet-stream',size:file.size,path:`${options.shared?'shared':schoolId}/${id}/${name}`,createdAt:Date.now(),state:'queued',bytes:0,speed:0,uploaded:false,attempts:0,retryAt:0,
     options:{...options,title:files.length>1?(options.kind==='app'?'':file.name.slice(0,160)):options.title|| (options.kind==='app'?'':file.name.slice(0,160))}}};
   });
   try{await engine.current.enqueue(entries);}catch{throw new Error('Could not save the selected files in browser storage. Select fewer files and try again.');}
   setError(undefined);setOpen(true);
  },
  pause:id=>{void engine.current?.pause(id).catch(()=>setError('Could not pause this upload.'));},
  retry:id=>{void engine.current?.retry(id).catch(()=>setError('Could not retry this upload.'));},
  remove:id=>{void engine.current?.remove(id).catch(()=>setError('Could not remove this queue entry.'));},
 }),[jobs,ready,leader,open,error,userId,schools]);
 return <Context.Provider value={value}>{children}<UploadPanel/></Context.Provider>;
}

export function UploadQueueButton(){
 const {jobs,open,setOpen}=useUploads();const active=jobs.filter(j=>j.state!=='done').length;
 return <button type="button" className="icon-button relative gap-1.5" style={{width:'auto',padding:'0 9px'}} onClick={()=>setOpen(!open)} aria-label={`Background uploads${active?`, ${active} pending`:''}`} aria-controls="background-upload-panel" aria-expanded={open} title="Background uploads"><UploadCloud size={17}/><span className="hidden text-[11px] sm:inline">Uploads</span>{active>0&&<span className="absolute -top-1 -right-1 rounded-full bg-brand-600 px-1 text-[9px] leading-4 text-white">{active}</span>}</button>;
}
function bytes(value:number){return value>=1_000_000?`${(value/1_000_000).toFixed(1)} MB`:`${Math.ceil(value/1000)} KB`;}
function UploadPanel(){
 const {jobs,leader,open,setOpen,error,pause,retry,remove}=useUploads();
 if(!open)return null;
 const remaining=jobs.filter(j=>j.state!=='done').length;
 return <aside id="background-upload-panel" aria-label="Background uploads" className="fixed right-3 bottom-3 z-[80] flex max-h-[75vh] w-[calc(100vw-1.5rem)] max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
  <div className="flex items-center justify-between gap-3 border-b border-line p-4"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><UploadCloud size={17}/>Background uploads</h2><p className="mt-1 text-[11px] text-muted">{remaining} pending - You can continue using the dashboard.</p></div><button type="button" className="icon-button" aria-label="Close upload panel" onClick={()=>setOpen(false)}><X size={16}/></button></div>
  <div className="overflow-y-auto p-3">{error&&<p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}{!leader&&jobs.some(j=>j.state!=='done')&&<p className="mb-3 text-xs text-muted">Another dashboard tab manages this queue. Use that tab to pause or retry uploads.</p>}{jobs.length===0&&<p className="p-5 text-center text-xs text-muted">Choose APKs, notes or wallpapers to start an upload.</p>}
   {[...jobs].reverse().map(job=>{
    const percentage=Math.floor(job.bytes/Math.max(1,job.size)*100),publishing=job.state==='publishing';
    const label=job.state==='done'?'Published':publishing?(job.options.kind==='app'?'Reading APK details and publishing...':'Publishing to library...'):job.state==='uploading'?(percentage>=100?'Upload sent - waiting for server':`Uploading - ${percentage}%`):job.state==='queued'?navigator.onLine?'Queued':'Waiting for internet':job.state==='waiting'?navigator.onLine?'Waiting to retry':'Waiting for internet':job.state==='paused'?'Paused':'Needs attention';
    return <article key={job.id} className="mb-2 rounded-xl border border-line bg-panel p-3"><div className="flex items-start gap-2">{job.state==='done'?<CheckCircle2 size={16} className="shrink-0 text-emerald-600"/>:job.state==='failed'?<AlertCircle size={16} className="shrink-0 text-red-600"/>:publishing||job.state==='uploading'?<LoaderCircle size={16} className="shrink-0 animate-spin text-brand-600"/>:<UploadCloud size={16} className="shrink-0 text-muted"/>}<div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold" title={job.name}>{job.name}</p><p className="mt-1 truncate text-[10px] text-muted">{job.options.shared?'RoboKorda shared library':job.schoolName}</p></div></div>
     <div className="mt-3 flex items-center justify-between gap-2 text-[11px]"><span role="status">{label}</span><span className="text-muted">{job.speed>0?`${bytes(job.speed)}/s`:bytes(job.size)}</span></div>
     <progress className="upload-progress mt-2" data-state={job.state} value={job.bytes} max={job.size} aria-label={`${job.name} upload progress`}/>
     <p className="mt-1 text-[10px] text-muted">{bytes(job.bytes)} of {bytes(job.size)}</p>
     {job.error&&<p className="mt-2 break-words text-[11px] text-red-600">{job.error}</p>}
     <div className="mt-2 flex justify-end gap-3">{['queued','waiting','uploading'].includes(job.state)&&<button type="button" disabled={!leader} className="inline-flex items-center gap-1 text-[11px] text-muted disabled:opacity-40" onClick={()=>pause(job.id)}><Pause size={11}/>Pause</button>}{['paused','failed','waiting'].includes(job.state)&&<button type="button" disabled={!leader} className="inline-flex items-center gap-1 text-[11px] text-brand-700 disabled:opacity-40" onClick={()=>retry(job.id)}>{job.state==='paused'?<Play size={11}/>:<RotateCcw size={11}/>}{job.state==='paused'?'Resume':'Retry'}</button>}{['done','failed','paused'].includes(job.state)&&<button type="button" disabled={!leader} className="text-[11px] text-muted disabled:opacity-40" onClick={()=>remove(job.id)}>Remove from queue</button>}</div>
    </article>;
   })}
  </div><p className="border-t border-line px-4 py-3 text-[10px] leading-4 text-muted">Keep a dashboard tab open for transfers. If you close it, saved jobs continue when you return. An interrupted file may upload again; published files are not duplicated. Removing a queue entry does not delete a library item.</p>
 </aside>;
}
