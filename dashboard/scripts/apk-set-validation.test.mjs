import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const module={exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync(new URL('../src/lib/apk-set-validation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(module,module.exports);
const {validateApkParts}=module.exports;
const base=(overrides={})=>({name:'base.apk',packageName:'test.app',versionCode:'340',split:'',minSdk:24,requiredTypes:[],splitTypes:[],requiresSplits:false,dependencies:[],configForSplit:'',...overrides});
const split=(overrides={})=>base({name:'split_config.arm64_v8a.apk',split:'config.arm64_v8a',splitTypes:['base__abi'],...overrides});
test('standalone APK passes without requiring minimum SDK to match target SDK',()=>assert.equal(validateApkParts([base()],false).packageName,'test.app'));
test('base-only and split-only uploads fail with actionable messages',()=>{
 assert.throws(()=>validateApkParts([base({requiresSplits:true})],false),/companion splits/);
 assert.throws(()=>validateApkParts([split()],false),/complete app folder/);
 assert.throws(()=>validateApkParts([base({requiredTypes:['base__abi']})],false),/companion splits/);
});
test('complete ABI and density package passes; missing type fails',()=>{
 const b=base({requiresSplits:true,requiredTypes:['base__abi','base__density']});
 const d=split({name:'split_config.xxxhdpi.apk',split:'config.xxxhdpi',splitTypes:['base__density']});
 assert.equal(validateApkParts([b,split(),d],true),b);
 assert.throws(()=>validateApkParts([b,split()],true),/base__density/);
});
test('mixed apps, versions, duplicate names and duplicate splits fail',()=>{
 for(const s of [split({packageName:'different.app'}),split({versionCode:'341'}),split({name:'BASE.APK'}),split({split:''})])assert.throws(()=>validateApkParts([base(),s],true));
});
test('missing feature/config dependencies fail; complete feature passes',()=>{
 assert.throws(()=>validateApkParts([base(),split({dependencies:['feature']})],true),/missing split feature/);
 assert.throws(()=>validateApkParts([base(),split({configForSplit:'feature'})],true),/missing split feature/);
 assert.equal(validateApkParts([base(),split({configForSplit:'feature'}),split({name:'feature.apk',split:'feature',splitTypes:[]})],true).name,'base.apk');
});
test('Android 12 and 13 minimum requirements fail against current Android 11 fleet',()=>{
 for(const minSdk of [32,33,NaN,0])assert.throws(()=>validateApkParts([base({minSdk})],true),/API 30/);
});
test('paths, missing base, empty or oversized sets fail',()=>{
 for(const parts of [[],[base({name:'../base.apk'})],[base({name:'renamed.apk'})],Array.from({length:101},()=>base())])assert.throws(()=>validateApkParts(parts,true));
});
