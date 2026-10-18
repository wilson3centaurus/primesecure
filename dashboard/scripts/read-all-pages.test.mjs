import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const mod={exports:{}};new Function('module','exports',ts.transpileModule(readFileSync(new URL('../src/lib/read-all-pages.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod,mod.exports);
test('libraries larger than the API row limit are read completely',async()=>{
 const all=Array.from({length:2116},(_,id)=>({id})),calls=[];
 const result=await mod.exports.readAllPages(async(start,end)=>{calls.push([start,end]);return {data:all.slice(start,end+1),error:null};});
 assert.deepEqual(result.data,all);assert.equal(calls.length,5);assert.deepEqual(calls.at(-1),[2000,2499]);
});
test('a failed page is surfaced rather than presenting a partial library as complete',async()=>{
 const result=await mod.exports.readAllPages(async start=>start?{data:null,error:{message:'Offline'}}:{data:Array(500).fill({id:1}),error:null});
 assert.equal(result.data,null);assert.equal(result.error.message,'Offline');
});
