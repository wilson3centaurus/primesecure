export type UploadOptions={kind:string;shared:boolean;title:string;description:string;form:string;subject:string;category:string;preinstall:boolean};
export type UploadState='queued'|'uploading'|'publishing'|'waiting'|'paused'|'failed'|'done';
export type UploadJob={id:string;ownerId:string;schoolId:string;schoolName:string;name:string;mime:string;size:number;path:string;options:UploadOptions;createdAt:number;state:UploadState;bytes:number;speed:number;uploaded:boolean;attempts:number;retryAt:number;error?:string};
export type UploadEntry={job:UploadJob;file:Blob};
export interface UploadRepository {
 list(owner:string):Promise<UploadJob[]>;
 add(entries:UploadEntry[]):Promise<void>;
 put(job:UploadJob):Promise<void>;
 file(id:string):Promise<Blob|undefined>;
 releaseFile(id:string):Promise<void>;
 remove(id:string):Promise<void>;
}
export class UploadFailure extends Error {constructor(message:string,public retryable=false){super(message);}}
export type UploadDependencies={repository:UploadRepository;online:()=>boolean;transfer:(job:UploadJob,file:Blob,signal:AbortSignal,progress:(bytes:number,speed:number)=>void)=>Promise<void>;publish:(job:UploadJob,signal:AbortSignal)=>Promise<void>;completed:()=>void;changed:(jobs:UploadJob[],error?:string)=>void;now?:()=>number};

/** Lives outside route components. File data and progress history never contain session tokens. */
export class UploadQueue {
 private jobs:UploadJob[]=[];
 private running=new Map<string,AbortController>();
 private writes=new Map<string,Promise<void>>();
 private timer?:ReturnType<typeof setInterval>;
 private stopped=true;
 private leader=false;
 private syncing=false;
 private now:()=>number;
 constructor(private owner:string,private deps:UploadDependencies){this.now=deps.now||Date.now;}
 async start(leader:boolean){
  if(this.timer)clearInterval(this.timer);
  this.leader=leader;this.stopped=false;
  while(this.syncing&&!this.stopped)await new Promise(resolve=>setTimeout(resolve,10));
  await this.sync(true);
  if(this.stopped)return;
  this.timer=setInterval(()=>{void this.sync().then(()=>this.pump()).catch(()=>this.emit('Could not read the saved upload queue.'));},1000);
  this.pump();
 }
 stop(){this.stopped=true;if(this.timer)clearInterval(this.timer);for(const controller of this.running.values())controller.abort();}
 async enqueue(entries:UploadEntry[]){
  if(entries.some(e=>e.job.ownerId!==this.owner))throw new Error('Upload account changed. Reload and try again.');
  await this.deps.repository.add(entries);await this.sync();this.pump();
 }
 private emit(error?:string){if(!this.stopped)this.deps.changed(this.jobs.map(j=>({...j})),error);}
 private async sync(initial=false){
  if(this.syncing||this.stopped)return;this.syncing=true;
  try {
   const saved=await this.deps.repository.list(this.owner);
   if(initial&&this.leader)for(const job of saved)if(job.state==='uploading'||job.state==='publishing'){
    job.state='queued';job.speed=0;job.error=undefined;await this.deps.repository.put(job);
   }
   this.jobs=saved.map(j=>this.running.has(j.id)?this.jobs.find(local=>local.id===j.id)||j:j).sort((a,b)=>a.createdAt-b.createdAt);
   this.emit();
  }finally{this.syncing=false;}
 }
 private save(job:UploadJob){
  const snapshot={...job};
  const write=(this.writes.get(job.id)||Promise.resolve()).catch(()=>{}).then(()=>this.deps.repository.put(snapshot));
  this.writes.set(job.id,write);return write;
 }
 private pump(){
  if(this.stopped||!this.leader||!this.deps.online())return;
  for(const job of this.jobs){
   if(this.running.size>=2)break;
   if(this.running.has(job.id)||!['queued','waiting'].includes(job.state)||job.retryAt>this.now())continue;
   const controller=new AbortController();this.running.set(job.id,controller);
   void this.run(job,controller).catch(()=>this.emit('Could not save an upload state. Retry after reloading.')).finally(()=>{this.running.delete(job.id);this.pump();});
  }
 }
 private async run(job:UploadJob,controller:AbortController){
  try{
   if(this.stopped||this.isPaused(job))return;
   job.attempts++;job.error=undefined;job.speed=0;
   if(!job.uploaded){
    const file=await this.deps.repository.file(job.id);
    if(this.stopped||this.isPaused(job)||controller.signal.aborted)return;
    if(!file)throw new UploadFailure('The saved file is unavailable. Remove this job and select the file again.');
    job.state='uploading';job.bytes=0;await this.save(job);this.emit();let persisted=0;
    await this.deps.transfer(job,file,controller.signal,(bytes,speed)=>{
     if(this.stopped||job.state!=='uploading')return;
     job.bytes=Math.min(job.size,Math.max(0,bytes));job.speed=speed;this.emit();
     if(this.now()-persisted>1000){persisted=this.now();void this.save(job).catch(()=>{});}
    });
    job.uploaded=true;job.bytes=job.size;
   }
   if(this.stopped||this.isPaused(job))return;
   job.state='publishing';job.speed=0;await this.save(job);this.emit();
   await this.deps.publish(job,controller.signal);
   job.state='done';job.error=undefined;await this.save(job);await this.deps.repository.releaseFile(job.id).catch(()=>{});this.emit();
   this.deps.completed();
  }catch(error){
   if(this.isPaused(job)||(controller.signal.aborted&&job.state==='queued'))return;
   job.speed=0;
   if(this.stopped){job.state='queued';await this.save(job);return;}
   const retryable=error instanceof UploadFailure&&error.retryable;
   job.state=retryable&&job.attempts<5?'waiting':'failed';
   job.retryAt=this.now()+Math.min(60_000,2000*2**Math.max(0,job.attempts-1));
   job.error=error instanceof Error?error.message:'Upload failed. Try again.';
   await this.save(job);this.emit();
  }
 }
 private isPaused(job:UploadJob){return job.state==='paused';}
 async pause(id:string){
  if(!this.leader)return;const job=this.jobs.find(j=>j.id===id);
  if(!job||!['queued','waiting','uploading'].includes(job.state))return;
  job.state='paused';job.speed=0;this.running.get(id)?.abort();await this.save(job);this.emit();
 }
 async retry(id:string){
  if(!this.leader)return;const job=this.jobs.find(j=>j.id===id);
  if(!job||!['failed','paused','waiting'].includes(job.state))return;
  job.state='queued';job.retryAt=0;job.attempts=0;job.error=undefined;await this.save(job);this.emit();this.pump();
 }
 async remove(id:string){
  if(!this.leader||this.running.has(id))return;const job=this.jobs.find(j=>j.id===id);
  if(!job||!['done','failed','paused'].includes(job.state))return;
  // Never delete a server object here: an earlier publish response may have been lost.
  // Removing queue history must not delete an app or resource already in the library.
  await this.deps.repository.remove(id);this.writes.delete(id);this.jobs=this.jobs.filter(j=>j.id!==id);this.emit();
 }
}
