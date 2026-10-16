import { createClient } from '@/lib/supabase/browser';
import { SUPABASE_URL,SUPABASE_ANON_KEY } from '@/lib/env';
import { UploadFailure,type UploadJob } from './upload-queue';

export async function transferUpload(job:UploadJob,file:Blob,signal:AbortSignal,progress:(bytes:number,speed:number)=>void){
 if(signal.aborted)throw new DOMException('Paused','AbortError');
 const client=createClient();const {data:{session}}=await client.auth.getSession();
 if(!session||session.user.id!==job.ownerId)throw new UploadFailure('Sign in with the account that queued this upload, then Retry.');
 // A lost response/reload can leave a complete object. Reuse it rather than upload twice.
 const slash=job.path.lastIndexOf('/');
 const existing=await client.storage.from('primesecure-hub').list(job.path.slice(0,slash),{search:job.path.slice(slash+1)});
 if(existing.data?.some(row=>row.name===job.path.slice(slash+1)&&Number(row.metadata?.size)===job.size)){progress(job.size,0);return;}
 if(signal.aborted)throw new DOMException('Paused','AbortError');
 return new Promise<void>((resolve,reject)=>{
  const xhr=new XMLHttpRequest();let settled=false,lastTime=performance.now(),lastBytes=0,lastDraw=0;
  const finish=(error?:Error)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);if(error)reject(error);else resolve();};
  const abort=()=>{xhr.abort();finish(new DOMException('Paused','AbortError'));};
  const encoded=job.path.split('/').map(encodeURIComponent).join('/');
  xhr.open('POST',`${SUPABASE_URL.replace(/\/$/,'')}/storage/v1/object/primesecure-hub/${encoded}`);
  xhr.setRequestHeader('apikey',SUPABASE_ANON_KEY);xhr.setRequestHeader('Authorization',`Bearer ${session.access_token}`);xhr.setRequestHeader('x-upsert','false');
  xhr.timeout=30*60_000;
  xhr.upload.onprogress=event=>{
   if(!event.lengthComputable)return;const now=performance.now(),bytes=Math.min(job.size,Math.round(job.size*event.loaded/event.total));
   if(now-lastDraw<200&&event.loaded<event.total)return;
   const speed=(bytes-lastBytes)/Math.max(.001,(now-lastTime)/1000);lastBytes=bytes;lastTime=now;lastDraw=now;progress(bytes,speed);
  };
  xhr.onload=()=>{
   if(xhr.status>=200&&xhr.status<300){progress(job.size,0);finish();return;}
   let message='';try{message=JSON.parse(xhr.responseText).message||JSON.parse(xhr.responseText).error||'';}catch{}
   finish(new UploadFailure(xhr.status===413?'This file exceeds the server upload limit. Ask RoboKorda to increase the storage limit.':xhr.status===401?'Your session expired. Sign in again and Retry.':`Upload failed${message?': '+message:'. Please Retry.'}`,xhr.status===0||xhr.status===429||xhr.status>=500));
  };
  xhr.onerror=()=>finish(new UploadFailure('Connection interrupted. The upload will retry when connected.',true));
  xhr.ontimeout=()=>finish(new UploadFailure('The upload timed out. It will retry.',true));
  xhr.onabort=()=>finish(new DOMException('Paused','AbortError'));
  signal.addEventListener('abort',abort,{once:true});
  const body=new FormData();body.append('cacheControl','3600');body.append('',file,job.name);xhr.send(body);
 });
}

export async function publishUpload(job:UploadJob,signal:AbortSignal){
 const response=await fetch('/api/library/publish',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({...job.options,uploadId:job.id,ownerId:job.ownerId,schoolId:job.schoolId,path:job.path,mime:job.mime,size:job.size})}).catch(error=>{if(signal.aborted)throw error;throw new UploadFailure('Connection interrupted while publishing. It will retry without uploading the file again.',true);});
 const result=await response.json().catch(()=>({error:'Publishing did not finish. Retry this upload.'}));
 if(!response.ok||result.error)throw new UploadFailure(result.error||'Could not publish this file.',response.status===429||response.status>=500);
}
