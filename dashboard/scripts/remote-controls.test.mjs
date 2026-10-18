import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const device='12345678-1234-1234-1234-123456789012',caseId='87654321-1234-1234-1234-123456789012';
const source=readFileSync(new URL('../src/app/(app)/devices/remote-control-actions.ts',import.meta.url),'utf8');
function setup({allowed=true,school={id:'school-a'},current={id:device,school_id:'school-a',status:'active'},readError=null,rpcError=null}={}) {
 const calls=[],filters=[],paths=[];let reads=0;
 const db={from(table){assert.equal(table,'devices');const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},async maybeSingle(){reads++;return {data:current,error:readError};}};return q;},async rpc(name,args){calls.push([name,args]);return {error:rpcError};}};
 const imports={'next/cache':{revalidatePath:path=>paths.push(path)},'@/lib/auth':{requireStaff:async()=>({role:'school_admin'}),getCurrentSchool:async()=>school,canManage:(_staff,id)=>allowed&&id==='school-a'},'@/lib/supabase/server':{createClient:async()=>db}};
 const m={exports:{}};
 new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{assert(name in imports,name);return imports[name];},m,m.exports);
 return {calls,paths,filters,get reads(){return reads;},async run(fields={}){
  const form=new FormData();for(const [k,v] of Object.entries({device_id:device,type:'alarm',reason:'Find a misplaced school Primebook',authorized:'on',seconds:'15',...fields}))form.set(k,v);
  return m.exports.requestRemoteControl(undefined,form);
 }};
}
test('requires manager and selected school before DB reads',async()=>{for(const options of [{allowed:false},{school:null}]){const t=setup(options);assert.match((await t.run()).error,/administrator/);assert.equal(t.reads,0);}});
test('rejects invalid identifiers, type, reason and unchecked authorization without RPC',async()=>{
 for(const fields of [{device_id:'../secret'},{type:'livestream'},{reason:'bad'},{reason:'x'.repeat(501)},{authorized:''}]){const t=setup();assert((await t.run(fields)).error);assert.equal(t.calls.length,0);}
});
test('alarm cannot exceed bounds or use fractional duration',async()=>{
 for(const seconds of ['0','4','31','2.5','NaN']){const t=setup();assert.match((await t.run({seconds})).error,/5 to 30/);assert.equal(t.calls.length,0);}
});
test('checks the selected-school device, enrollment state and read failure',async()=>{
 for(const options of [{current:null},{current:{school_id:'school-b',status:'active'}},{current:{school_id:'school-a',status:'retired'}},{current:{school_id:'school-a',status:'pending'}},{readError:{message:'offline'}}]){const t=setup(options);assert((await t.run()).error);assert.equal(t.calls.length,0);}
});
test('queues bounded alarm through authenticated RPC and reports request rather than actual sound',async()=>{
 const t=setup();assert.match((await t.run()).ok,/queued.*expires after 2 minutes/);
 assert.deepEqual(t.filters,[['id',device],['school_id','school-a']]);
 assert.equal(t.calls[0][0],'staff_request_remote_control');assert.equal(t.calls[0][1].p_seconds,15);assert.equal(t.calls[0][1].p_authorized,true);
 assert.deepEqual(t.paths,[`/devices/${device}`]);
});
test('capture accepts only one photo/screenshot request; student consent is explicit',async()=>{
 for(const fields of [{kind:'video'},{kind:'screenshot',case_id:'invalid'}]){const t=setup();assert((await t.run({type:'request_capture',...fields})).error);assert.equal(t.calls.length,0);}
 const t=setup();assert.match((await t.run({type:'request_capture',kind:'screenshot',case_id:caseId})).ok,/student must allow, review and send one image/);
 assert.equal(t.calls[0][1].p_case,caseId);assert.equal(t.calls[0][1].p_kind,'screenshot');assert(t.paths.includes('/cases'));
});
test('RPC errors stay visible and do not claim delivery',async()=>{const t=setup({rpcError:{message:'Wait one minute between remote control requests'}});assert.match((await t.run()).error,/one minute/);assert.equal(t.paths.length,0);});
test('UI has reason, explicit authorization, confirmation and honest capture limits',()=>{
 const ui=readFileSync(new URL('../src/components/remote-controls.tsx',import.meta.url),'utf8');
 for(const pattern of [/name="authorized" required/,/name="reason" required/,/confirm=/,/Android protected screens/,/Automatic event screenshots are not enabled/])assert.match(ui,pattern);
 const route=readFileSync(new URL('../src/app/api/remote-capture/[id]/route.ts',import.meta.url),'utf8');
 assert.match(route,/no-store/);assert.match(route,/eq\("school_id", school.id\)/);assert.match(route,/gt\("expires_at"/);assert.doesNotMatch(route,/createAdminClient/);
});
test('image endpoint verifies selected school, expiry and manager role; returns private JPEG only',async()=>{
 const route=readFileSync(new URL('../src/app/api/remote-capture/[id]/route.ts',import.meta.url),'utf8');
 for(const options of [{allowed:false},{row:null},{error:{message:'offline'}},{row:{school_id:'school-b',image:'ignored'}},{}]) {
  const filters=[];const m={exports:{}};
  const row=Object.hasOwn(options,'row')?options.row:{school_id:'school-a',image:'data:image/jpeg;base64,/9j/4AAA',expires_at:'2100-01-01'};
  const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},gt(k,v){filters.push([k,v]);return q;},async maybeSingle(){return {data:row,error:options.error||null};}};
  const imports={'@/lib/auth':{requireStaff:async()=>({role:'school_admin'}),getCurrentSchool:async()=>({id:'school-a'}),canManage:(_staff,id)=>options.allowed!==false&&id==='school-a'},'@/lib/supabase/server':{createClient:async()=>({from(table){assert.equal(table,'remote_capture_frames');return q;}})}};
  new Function('require','module','exports',ts.transpileModule(route,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>imports[name],m,m.exports);
  const result=await m.exports.GET(new Request('https://school.example'),{params:Promise.resolve({id:device})});
  if(Object.keys(options).length)assert.equal(result.status,404);
  else { assert.equal(result.status,200);assert.equal(result.headers.get('content-type'),'image/jpeg');assert(filters.some(([k,v])=>k==='school_id'&&v==='school-a'));assert(filters.some(([k])=>k==='expires_at')); }
  assert.match(result.headers.get('cache-control'),/private, no-store/);
 }
});
