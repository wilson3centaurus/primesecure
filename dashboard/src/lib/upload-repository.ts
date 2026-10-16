import type { UploadEntry,UploadJob,UploadRepository } from './upload-queue';

export class BrowserUploadRepository implements UploadRepository {
 private database?:Promise<IDBDatabase>;
 private open(){return this.database??=new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open('primesecure-background-uploads',1);
  request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('jobs',{keyPath:'id'}).createIndex('owner','ownerId');db.createObjectStore('files');};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });}
 private async transaction<T>(stores:string[],mode:IDBTransactionMode,run:(tx:IDBTransaction,done:(value:T)=>void)=>void):Promise<T>{
  const db=await this.open();return new Promise((resolve,reject)=>{
   const tx=db.transaction(stores,mode);let result:T;run(tx,value=>{result=value;});
   tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Could not save upload queue.'));
  });
 }
 list(owner:string){return this.transaction<UploadJob[]>(['jobs'],'readonly',(tx,done)=>{const request=tx.objectStore('jobs').index('owner').getAll(owner);request.onsuccess=()=>done(request.result);});}
 add(entries:UploadEntry[]){return this.transaction<void>(['jobs','files'],'readwrite',tx=>{for(const entry of entries){tx.objectStore('jobs').add(entry.job);tx.objectStore('files').add(entry.file,entry.job.id);}});}
 put(job:UploadJob){return this.transaction<void>(['jobs'],'readwrite',tx=>{tx.objectStore('jobs').put(job);});}
 file(id:string){return this.transaction<Blob|undefined>(['files'],'readonly',(tx,done)=>{const request=tx.objectStore('files').get(id);request.onsuccess=()=>done(request.result);});}
 releaseFile(id:string){return this.transaction<void>(['files'],'readwrite',tx=>{tx.objectStore('files').delete(id);});}
 remove(id:string){return this.transaction<void>(['jobs','files'],'readwrite',tx=>{tx.objectStore('jobs').delete(id);tx.objectStore('files').delete(id);});}
}
