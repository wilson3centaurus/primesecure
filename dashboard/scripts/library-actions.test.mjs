import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
const source=fs.readFileSync(new URL('../src/app/(app)/library/actions.ts',import.meta.url),'utf8');
function setup({shared=false,manager=true,insertFails=false}={}){
 const calls=[];const item={id:'source',school_id:shared?null:'school-a',kind:'resource',title:'Chemistry',description:'Notes',storage_path:(shared?'shared':'school-a')+'/original.pdf',size:20,mime_type:'application/pdf',published:true};
 const storage={copy:async(a,b)=>{calls.push(['copy',a,b]);return {}},remove:async paths=>{calls.push(['remove',paths]);return {}}};
 const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:item}),update:()=>{calls.push(['move']);return query},single:async()=>({data:{id:'source'}}),insert:async data=>{calls.push(['insert',data]);return insertFails?{error:{message:'Insert failed'}}:{}}};
 const imports={'next/cache':{revalidatePath:p=>calls.push(['revalidate',p])},'@/lib/auth':{requireStaff:async()=>({role:'school_admin'}),getCurrentSchool:async()=>({id:'school-a'}),canManage:()=>manager},'@/lib/supabase/server':{createClient:async()=>({from:()=>query,storage:{from:()=>storage}})},'@/lib/apk':{}};
 const mod={exports:{}};new Function('require','module','exports','crypto',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(name=>{if(name in imports)return imports[name];throw Error(name)},mod,mod.exports,webcrypto);
 const form=new FormData();form.set('id','source');form.set('target',JSON.stringify(['Form 4','Chemistry','Past exam papers']));form.set('action','copy');return {run:()=>mod.exports.organiseNoteFile(undefined,form),calls,form};
}
test('copy duplicates storage into current school and preserves original',async()=>{
 const x=setup({shared:true});assert((await x.run()).ok);const copy=x.calls.find(c=>c[0]==='copy'),insert=x.calls.find(c=>c[0]==='insert')[1];assert.equal(copy[1],'shared/original.pdf');assert.match(copy[2],/^school-a\/[0-9a-f-]{36}\/original.pdf$/);assert.equal(insert.storage_path,copy[2]);assert.equal(insert.school_id,'school-a');assert.equal(insert.category,'Past exam papers');assert(!x.calls.some(c=>c[0]==='move'||c[0]==='remove'));
});
test('school admin cannot move a shared original or act without management rights',async()=>{
 const x=setup({shared:true});x.form.set('action','move');assert((await x.run()).error);assert.equal(x.calls.length,0);const y=setup({manager:false});assert((await y.run()).error);assert.equal(y.calls.length,0);
});
test('failed publish cleans up only the new copy and leaves source untouched',async()=>{
 const x=setup({insertFails:true});assert((await x.run()).error);const copy=x.calls.find(c=>c[0]==='copy'),removed=x.calls.find(c=>c[0]==='remove');assert.deepEqual(removed[1],[copy[2]]);assert.notEqual(copy[1],copy[2]);
});
test('malformed destinations cannot reach storage or metadata updates',async()=>{
 for(const path of [[],['one','two'],['one','two','bad/path']]){const x=setup();x.form.set('target',JSON.stringify(path));assert((await x.run()).error);assert.equal(x.calls.length,0);}
});
