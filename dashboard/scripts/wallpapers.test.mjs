import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/app/(app)/library/wallpaper-actions.ts',import.meta.url),'utf8');
function setup({role='school_admin',allowed=true,school={id:'a'},item={id:'image',kind:'wallpaper',school_id:'a',storage_path:'a/image.jpg'},readError=null,writeError=null,removed=[{id:'image'}],cleanupError=null}={}){
 const writes=[],files=[],paths=[];let reads=0;
 const db={from(table){assert.equal(table,'hub_items');const q={select(){return q;},eq(){return q;},async maybeSingle(){reads++;return {data:item,error:readError};},delete(){const filters=[];const d={eq(k,v){filters.push([k,v]);return d;},async select(){writes.push(filters);return {data:removed,error:writeError};}};return d;}};return q;},storage:{from(bucket){assert.equal(bucket,'primesecure-hub');return {async remove(paths){files.push(...paths);return {error:cleanupError};}};}}};
 const imports={'next/cache':{revalidatePath:p=>paths.push(p)},'@/lib/auth':{requireStaff:async()=>({role}),getCurrentSchool:async()=>school,canManage:()=>allowed},'@/lib/supabase/server':{createClient:async()=>db}};
 const m={exports:{}};new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(n=>{assert(n in imports);return imports[n];},m,m.exports);
 return {run:async()=>{const f=new FormData();f.set('id','image');return m.exports.deleteWallpaper(undefined,f);},writes,files,paths,get reads(){return reads;}};
}
test('requires a manager and selected school before reading the database',async()=>{for(const o of [{allowed:false},{school:null}]){const t=setup(o);assert.match((await t.run()).error,/Administrator/);assert.equal(t.reads,0);}});
test('rejects other schools, shared wallpaper for school admins, and non-wallpapers',async()=>{for(const item of [{school_id:'b',kind:'wallpaper'},{school_id:null,kind:'wallpaper'},{school_id:'a',kind:'app'}]){const t=setup({item});assert((await t.run()).error);assert.equal(t.writes.length,0);assert.equal(t.files.length,0);}});
test('deletes own wallpaper, verifies affected rows, then cleans the stored image',async()=>{const t=setup();assert.match((await t.run()).ok,/Wallpaper deleted/);assert.deepEqual(t.writes,[[['id','image'],['kind','wallpaper']]]);assert.deepEqual(t.files,['a/image.jpg']);assert.deepEqual(t.paths,['/library','/wallpapers','/settings']);});
test('super admins may delete shared wallpapers',async()=>{const t=setup({role:'super_admin',item:{id:'image',kind:'wallpaper',school_id:null,storage_path:'shared/image.jpg'}});assert((await t.run()).ok);assert.deepEqual(t.files,['shared/image.jpg']);});
test('read errors, failed writes and denied/no-op deletes never remove storage',async()=>{for(const o of [{readError:{message:'read failed'}},{writeError:{message:'write failed'}},{removed:[]}]){const t=setup(o);assert((await t.run()).error);assert.equal(t.files.length,0);}});
test('storage failure reports the committed catalog deletion honestly',async()=>{const t=setup({cleanupError:{message:'offline'}});assert.match((await t.run()).ok,/cleanup needs attention/);});
test('wallpaper cards have only a top-right confirmed delete, with accessible text',()=>{
 const gallery=fs.readFileSync(new URL('../src/components/hub-library.tsx',import.meta.url),'utf8');const card=gallery.split("{kind==='wallpaper'&&<div")[1].split("{kind!=='resource'")[0];assert.match(card,/WallpaperDeleteButton/);assert.doesNotMatch(card,/HubItemAction|Withdraw|Republish|Enable|Disable/);assert(!gallery.includes('EnableAllWallpapersButton'));
 const button=fs.readFileSync(new URL('../src/components/wallpaper-delete.tsx',import.meta.url),'utf8');assert.match(button,/absolute right-2 top-2/);assert.match(button,/confirm=/);assert.match(button,/sr-only/);assert.match(button,/shared gallery for every school/);
});
