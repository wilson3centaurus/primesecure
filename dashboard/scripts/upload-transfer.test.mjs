import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
class UploadFailure extends Error{constructor(message,retryable=false){super(message);this.retryable=retryable;}}
const source=readFileSync(new URL('../src/lib/upload-transfer.ts',import.meta.url),'utf8');
function setup({expires=Date.now()/1000+3600,owner='owner',status=200,message='',refreshError=false,existing=false}={}){
 let refreshed=0,sent=0,headers={};
 const session={user:{id:owner},access_token:'old-token',expires_at:expires};
 const client={auth:{getSession:async()=>({data:{session}}),refreshSession:async()=>{refreshed++;return {error:refreshError?new Error('expired'):null,data:{session:{...session,access_token:'new-token',expires_at:Date.now()/1000+3600}}};}},storage:{from:()=>({list:async()=>({data:existing?[{name:'a.apk',metadata:{size:100}}]:[]})})}};
 class XHR{upload={};status=status;responseText=JSON.stringify({message});open(){}setRequestHeader(k,v){headers[k]=v;}send(){sent++;queueMicrotask(()=>this.onload());}abort(){this.onabort?.();}}
 const imports={'@/lib/supabase/browser':{createClient:()=>client},'@/lib/env':{SUPABASE_URL:'https://example.test',SUPABASE_ANON_KEY:'public'},'./upload-queue':{UploadFailure}};
 const mod={exports:{}};new Function('require','module','exports','XMLHttpRequest','fetch',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>imports[name],mod,mod.exports,XHR,async()=>({status,ok:status===200,json:async()=>({error:status===200?undefined:message})}));
 const job={ownerId:'owner',path:'school/id/a.apk',size:100,name:'a.apk',options:{kind:'app'}};
 return {transfer:()=>mod.exports.transferUpload(job,new Blob(['x']),new AbortController().signal,()=>{}),publish:()=>mod.exports.publishUpload(job,new AbortController().signal),get refreshed(){return refreshed},get sent(){return sent},headers};
}
test('a nearly expired session is renewed before sending file bytes',async()=>{const s=setup({expires:Date.now()/1000+30});await s.transfer();assert.equal(s.refreshed,1);assert.equal(s.sent,1);assert.equal(s.headers.Authorization,'Bearer new-token');});
test('the reported exp claim error renews the session and becomes retryable',async()=>{const s=setup({status:400,message:'"exp" claim timestamp check failed'});await assert.rejects(s.transfer(),e=>e instanceof UploadFailure&&e.retryable);assert.equal(s.refreshed,1);});
test('a changed account or failed refresh cannot upload',async()=>{
 const other=setup({owner:'someone-else',expires:0});await assert.rejects(other.transfer(),/account/);assert.equal(other.sent,0);assert.equal(other.refreshed,0);
 const expired=setup({expires:0,refreshError:true});await assert.rejects(expired.transfer(),/expired/);assert.equal(expired.sent,0);
});
test('an already transferred object is reused rather than uploaded again',async()=>{const s=setup({existing:true});await s.transfer();assert.equal(s.sent,0);});
test('expired publication retries metadata only after refreshing credentials',async()=>{const s=setup({status:401,message:'expired'});await assert.rejects(s.publish(),e=>e.retryable&&/without uploading/.test(e.message));assert.equal(s.refreshed,1);assert.equal(s.sent,0);});
