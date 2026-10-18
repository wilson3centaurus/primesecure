import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const mod={exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync(new URL('../src/lib/setup-progress.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod,mod.exports);
const { setupReport,streamPercent,setupDuration,effectiveWallpaper }=mod.exports;
const report=()=>({catalog_known:true,complete:false,clock_estimated:false,elapsed_ms:1000,streams:['wallpaper','app','resource'].map(kind=>({kind,total_items:2,completed_items:1,total_bytes:100,completed_bytes:100,elapsed_ms:1000,complete:false}))});
test('missing/unknown/malformed reports are not invented progress',()=>{for(const value of [null,{}, {...report(),catalog_known:false},{...report(),streams:[]},{...report(),complete:true}])assert.equal(setupReport(value),null);});
test('pending installation/integrity checks cap full-byte progress below 100%',()=>{const r=setupReport(report());assert(r);assert(r.streams.every(s=>streamPercent(s)===99));});
test('empty known streams are ready; duplicate streams and counters outside totals are rejected',()=>{const r=report();r.complete=true;r.streams.forEach(s=>{s.total_items=0;s.completed_items=0;s.complete=true;s.total_bytes=0;s.completed_bytes=0;});assert(setupReport(r).streams.every(s=>streamPercent(s)===100));const bad=report();bad.streams[1].kind='wallpaper';assert.equal(setupReport(bad),null);const invalid=report();invalid.streams[0].completed_items=3;assert.equal(setupReport(invalid),null);});
test('unknown duration is not a fake zero or finish estimate',()=>{assert.equal(setupDuration(null),'Not yet measured');assert.equal(setupDuration(0),'<1 sec');assert.equal(setupDuration(61000),'1 min 1 sec');assert.equal(setupDuration(90000000),'1 days 1 hr');});
test('UI labels completed-only samples, offline caveats, current catalogue, and private wallpaper previews',()=>{const text=fs.readFileSync(new URL('../src/components/setup-progress.tsx',import.meta.url),'utf8');for(const pattern of [/not an ETA/,/possibly offline/,/not a live connection/,/not unfinished devices/,/reset when its contents change/,/createSignedUrl\(item.storage_path, 180\)/,/eq\("published", true\)/,/wallpaper_choice_id/,/not a screenshot or proof/])assert.match(text,pattern);assert.doesNotMatch(text,/service.role|serviceRole/);});
test('queued installs have only one executor; urgent outbox does not wait on that transfer lock',()=>{const worker=fs.readFileSync(new URL('../../agent/app/src/main/java/com/robokorda/primesecure/OfflineWorker.kt',import.meta.url),'utf8');assert.match(worker,/setOf\("install", "download", "admin_command", "web_download"\)/);assert.doesNotMatch(worker,/\.install\(/);const hub=fs.readFileSync(new URL('../../agent/app/src/main/java/com/robokorda/primesecure/HubSync.kt',import.meta.url),'utf8');assert.match(hub,/SetupDownloadOrder.runPass/);assert.match(hub,/withTimeoutOrNull/);assert.match(hub,/OfflineWorker.schedule/);});

const wallpaper=(id,school_id=null,published=true)=>({id,title:id,storage_path:`${school_id??'shared'}/${id}.jpg`,school_id,published});
const setting=(id,school_id=null,allow_wallpaper_choice=true)=>({scope:school_id??'global',school_id,default_wallpaper_id:id,allow_wallpaper_choice});
test('wallpaper preview prefers a valid synced choice, then published school default, then master default',()=>{
  const items=[wallpaper('choice','A'),wallpaper('school','A'),wallpaper('master')];
  const settings=[setting('school','A'),setting('master')];
  assert.equal(effectiveWallpaper('A','choice',settings,items,[]).item.id,'choice');
  const school=effectiveWallpaper('A',null,settings,items,[]);
  assert.equal(school.item.id,'school');assert.match(school.label,/Inherited school default.*not confirmed device applied/);
  const master=effectiveWallpaper('A',null,settings,[items[2]],[]);
  assert.equal(master.item.id,'master');assert.match(master.label,/Inherited master default.*not confirmed device applied/);
});
test('unpublished, foreign-school, disabled and no-longer-enabled shared choices cannot win previews',()=>{
  const settings=[setting('master')];
  const master=wallpaper('master');
  for(const invalid of [wallpaper('bad','B'),wallpaper('bad','A',false),wallpaper('bad')])
    assert.equal(effectiveWallpaper('A','bad',settings,[invalid,master],[]).item.id,'master');
  assert.equal(effectiveWallpaper('A','bad',settings,[wallpaper('bad'),master],['bad']).item.id,'bad');
  assert.equal(effectiveWallpaper('A','bad',[setting('master',null,false)],[wallpaper('bad','A'),master],[]).item.id,'master');
  assert.equal(effectiveWallpaper('A',null,[setting('bad')],[wallpaper('bad','B')],[]),null);
});
test('wallpaper previews have an explicit manager gate, school-bound device lookup, and short-lived private URLs',()=>{
  const source=fs.readFileSync(new URL('../src/components/setup-progress.tsx',import.meta.url),'utf8');
  assert.match(source,/if \(!canManage\(staff, schoolId\)\) return null/);
  assert.match(source,/eq\("id", deviceId\).eq\("school_id", schoolId\)/);
  assert.match(source,/if \(!deviceResult.data\)/);
  assert.match(source,/createSignedUrl\(item.storage_path, 180\)/);
});
