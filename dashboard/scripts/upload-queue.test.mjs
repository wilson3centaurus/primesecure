import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function load(file,imports={}){const m={exports:{}};const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;new Function('require','module','exports',code)(name=>{if(name in imports)return imports[name];throw Error('Unexpected import '+name)},m,m.exports);return m.exports;}
const {UploadQueue,UploadFailure}=load('src/lib/upload-queue.ts');
const wait=async fn=>{for(let n=0;n<400;n++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected queue state did not arrive')};
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:()=>resolve()}};
class Repository{
 jobs=new Map();files=new Map();
 async list(owner){return [...this.jobs.values()].filter(j=>j.ownerId===owner).map(j=>structuredClone(j));}
 async add(entries){for(const {job,file}of entries){assert(!this.jobs.has(job.id));this.jobs.set(job.id,structuredClone(job));this.files.set(job.id,file);}}
 async put(job){this.jobs.set(job.id,structuredClone(job));}
 async file(id){return this.files.get(id)}
 async releaseFile(id){this.files.delete(id)}
 async remove(id){this.jobs.delete(id);this.files.delete(id)}
}
function entry(id,owner='owner'){return {job:{id,ownerId:owner,schoolId:'school-a',schoolName:'School A',name:id+'.apk',mime:'application/vnd.android.package-archive',size:100,path:'school-a/'+id+'/'+id+'.apk',options:{kind:'app',shared:false,title:'',description:'',form:'',subject:'',category:'Notes',preinstall:false},createdAt:Date.now(),state:'queued',bytes:0,speed:0,uploaded:false,attempts:0,retryAt:0},file:new Blob([new Uint8Array(100)])};}
function setup(t,overrides={},repository=new Repository(),owner='owner'){
 let view=[];const q=new UploadQueue(owner,{repository,online:()=>true,transfer:async(_j,_f,_s,p)=>p(100,100),publish:async()=>{},completed:()=>{},changed:jobs=>{view=jobs},...overrides});t.after(()=>q.stop());return {q,repository,get view(){return view}};
}
test('two concurrent uploads report bytes and publish only after the metadata step finishes',async t=>{
 const upload=deferred(),publish=deferred();let active=0,max=0,published=0;
 const state=setup(t,{transfer:async(_j,_f,_s,p)=>{active++;max=Math.max(max,active);p(50,25);await upload.promise;active--;p(100,0)},publish:async()=>{await publish.promise;published++}});
 await state.q.start(true);await state.q.enqueue(['a','b','c'].map(id=>entry(id)));
 await wait(()=>state.view.filter(j=>j.state==='uploading').length===2);assert.equal(max,2);assert.equal(state.view.find(j=>j.id==='a').bytes,50);assert.equal(state.view.find(j=>j.id==='c').state,'queued');
 upload.resolve();await wait(()=>state.view.some(j=>j.state==='publishing'));assert.equal(published,0);assert(!state.view.some(j=>j.state==='done'));publish.resolve();await wait(()=>state.view.every(j=>j.state==='done'));assert.equal(published,3);assert.equal(state.repository.files.size,0);
});
test('offline queued files start after reconnection without reopening the upload form',async t=>{
 let online=false,called=0;const state=setup(t,{online:()=>online,transfer:async()=>{called++}});await state.q.start(true);await state.q.enqueue([entry('offline')]);assert.equal(called,0);online=true;await wait(()=>state.view[0]?.state==='done');assert.equal(called,1);
});
test('an interrupted tab restores the file and original school when another workspace is open',async t=>{
 const repository=new Repository();let began=false;
 const first=setup(t,{transfer:async(_j,_f,signal)=>{began=true;await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError'))))}},repository);
 await first.q.start(true);await first.q.enqueue([entry('restored')]);await wait(()=>began);first.q.stop();await wait(()=>repository.jobs.get('restored').state==='queued');
 const published=[];const next=setup(t,{publish:async job=>published.push({id:job.id,school:job.schoolId})},repository);await next.q.start(true);await wait(()=>next.view[0]?.state==='done');assert.deepEqual(published,[{id:'restored',school:'school-a'}]);
});
test('lost publication responses retry with the same ID without uploading the APK again',async t=>{
 let transfers=0,publishes=0;const ids=[];const state=setup(t,{transfer:async()=>{transfers++},publish:async job=>{ids.push(job.id);if(++publishes===1)throw new UploadFailure('Lost response',true)}});await state.q.start(true);await state.q.enqueue([entry('dedup')]);await wait(()=>state.view[0]?.state==='waiting');assert.equal(state.view[0].uploaded,true);await state.q.retry('dedup');await wait(()=>state.view[0]?.state==='done');assert.equal(transfers,1);assert.deepEqual(ids,['dedup','dedup']);
});
test('pause retains the selected file and resume completes the same queue job',async t=>{
 let transfer=0;const state=setup(t,{transfer:async(_j,_f,signal)=>{if(++transfer===1)await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Paused','AbortError'))))}});await state.q.start(true);await state.q.enqueue([entry('pause')]);await wait(()=>transfer===1);await state.q.pause('pause');assert(state.repository.files.has('pause'));await state.q.retry('pause');await wait(()=>state.view[0]?.state==='done');assert.equal(transfer,2);
});
test('a failed APK does not stop other files, and removing queue history has no library deletion operation',async t=>{
 const state=setup(t,{publish:async job=>{if(job.id==='bad')throw new UploadFailure('Invalid APK')}});await state.q.start(true);await state.q.enqueue([entry('bad'),entry('good')]);await wait(()=>state.view.some(j=>j.state==='failed')&&state.view.some(j=>j.state==='done'));await state.q.remove('bad');assert.deepEqual(state.view.map(j=>j.id),['good']);assert(state.repository.jobs.has('good'));
});
test('saved jobs are account-scoped and a follower tab cannot execute the queue',async t=>{
 const repository=new Repository();await repository.add([entry('private','other')]);let transfers=0;const state=setup(t,{transfer:async()=>{transfers++}},repository);await state.q.start(false);assert.deepEqual(state.view,[]);await assert.rejects(state.q.enqueue([entry('wrong','other')]),/account changed/);await state.q.enqueue([entry('follower')]);assert.equal(transfers,0);await state.q.start(true);await wait(()=>state.view[0]?.state==='done');assert.equal(transfers,1);assert.equal(repository.jobs.get('private').state,'queued');
});
const owner='11111111-1111-4111-8111-111111111111',school='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
function publication({existing=null,duplicate=false,teacher=false}={}){
 const inserts=[];let row=existing,inspect=0;
 const client={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:row,error:null})})}),insert:async payload=>{inserts.push(payload);row=payload;return {error:duplicate?{code:'23505',message:'Duplicate'}:null}}}),storage:{from:()=>({list:async()=>({data:[{name:'learning.apk',metadata:{size:100}}],error:null}),download:async()=>({data:new Blob([new Uint8Array(100)]),error:null})})}};
 const actions=load('src/app/(app)/library/actions.ts',{'next/cache':{revalidatePath:()=>{}},'@/lib/auth':{requireStaff:async()=>({id:owner,role:teacher?'teacher':'school_admin',schoolId:school}),canManage:s=>s.role!=='teacher',getCurrentSchool:async()=>({id:'WRONG-CURRENT-WORKSPACE'})},'@/lib/supabase/server':{createClient:async()=>client},'@/lib/apk':{inspectApk:async()=>{inspect++;return {title:'Learning',packageName:'org.school.learning',version:'1.0',icon:null,sha256:'abc'}}}});
 return {publish:actions.publishItem,inserts,get inspected(){return inspect}};
}
const input={kind:'app',title:'',description:'',form:'',subject:'',category:'Notes',path:`${school}/${id}/learning.apk`,mime:'application/vnd.android.package-archive',size:100,shared:false,preinstall:false,schoolId:school,uploadId:id};
test('publication uses captured school and stable item ID, reads APK metadata, and is idempotent',async()=>{
 const state=publication();assert(!(await state.publish(input)).error);assert.equal(state.inserts[0].school_id,school);assert.equal(state.inserts[0].id,id);assert.equal(state.inserts[0].title,'Learning');assert.equal(state.inserts[0].package_name,'org.school.learning');assert(!(await state.publish(input)).error);assert.equal(state.inserts.length,1);assert.equal(state.inspected,1);
});
test('publication safely handles a concurrent same-ID insert and rejects role, scope and identity mismatches',async()=>{
 const duplicate=publication({duplicate:true});assert(!(await duplicate.publish(input)).error);
 assert.match((await publication({teacher:true}).publish(input)).error,/Administrator/);
 assert.match((await publication().publish({...input,path:`${school}/another/file.apk`})).error,/identity/);
 assert.match((await publication({existing:{kind:'app',school_id:school,storage_path:'different/path'}}).publish(input)).error,/already in use/);
});
test('publish endpoint enforces origin, session owner and typed metadata before publication',async()=>{
 let called=0;const route=load('src/app/api/library/publish/route.ts',{'@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:owner}}})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:owner}})})})})})},'@/app/(app)/library/actions':{publishItem:async data=>{called++;assert.equal(data.schoolId,school);return {ok:'Published'}}}});
 const req=(body,origin='https://dashboard.test')=>new Request('https://dashboard.test/api/library/publish',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await route.POST(req({...input,ownerId:owner},'https://elsewhere.test'))).status,403);
 assert.equal((await route.POST(req({...input,ownerId:'other'}))).status,403);
 assert.equal((await route.POST(req({...input,ownerId:owner,size:'100'}))).status,400);
 assert.equal((await route.POST(req({...input,ownerId:owner}))).status,200);assert.equal((await route.POST(new Request('http://internal:3105/api/library/publish',{method:'POST',headers:{origin:'https://dashboard.test',host:'dashboard.test','Content-Type':'application/json'},body:JSON.stringify({...input,ownerId:owner})}))).status,200);assert.equal(called,2);
});
