import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {zipSync,unzipSync,strToU8} from 'fflate';
const realRequire=createRequire(import.meta.url);
function load(file){
 const module={exports:{}};
 const source=fs.readFileSync(new URL('../src/lib/'+file+'.ts',import.meta.url),'utf8').replaceAll('import.meta.url',JSON.stringify(import.meta.url));
 const fakeReader={open:async bytes=>({readManifest:async()=>{
  const root=JSON.parse(Buffer.from(unzipSync(bytes)['AndroidManifest.xml']).toString());
  return {package:root.attributes.find(a=>a.name==='package').typedValue.value,versionName:'1.0',usesSdk:{minSdkVersion:24},application:{label:'Example'}};
 }})};
 const binaryParser=class {constructor(bytes){this.bytes=bytes;}parse(){return JSON.parse(this.bytes.toString());}};
 const require=name=>name==='server-only'?{}:name==='node:module'?{createRequire:()=>id=>id.endsWith('binaryxml')?binaryParser:fakeReader}:name.startsWith('./')?load(name.slice(2)):realRequire(name);
 new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText)(require,module,module.exports);return module.exports;
}
const {inspectAppPackage}=load('apk');
const node=(nodeName,values={},childNodes=[])=>({nodeName,attributes:Object.entries(values).map(([name,value])=>({name,typedValue:{value}})),childNodes});
function apk(extra={}){return zipSync({'AndroidManifest.xml':strToU8(JSON.stringify(node('manifest',{package:'test.app',versionCode:1,...extra},[node('uses-sdk',{minSdkVersion:24}),node('application')])) )},{level:0});}
const bundle=contents=>Buffer.from(zipSync(contents,{level:0}));
test('wrapper preserves APK bytes, returns container integrity hash and canonical MIME',async()=>{
 const b=apk(),s=apk({split:'config.en'}),bytes=bundle({'base.apk':b,'split_config.en.apk':s});
 const result=await inspectAppPackage(bytes,'Example.psapk');
 assert.equal(result.packageName,'test.app');assert.equal(result.mime,'application/vnd.primesecure.apk-set+zip');
 assert.equal(result.sha256,createHash('sha256').update(bytes).digest('hex'));
 assert.deepEqual(unzipSync(bytes)['base.apk'],b);assert.deepEqual(unzipSync(bytes)['split_config.en.apk'],s);
});
test('renamed standalone base requiring splits cannot be published',async()=>{
 await assert.rejects(inspectAppPackage(Buffer.from(apk({requiredSplitTypes:'base__abi'})),'Calculator.apk'),/requires companion splits/);
});
test('malformed ZIP, missing base, traversal, case collisions and nested content fail',async()=>{
 for(const bytes of [Buffer.from('not zip'),bundle({'split.apk':apk({split:'en'})}),bundle({'base.apk':apk(),'../x.apk':apk({split:'en'})}),bundle({'base.apk':apk(),'BASE.APK':apk({split:'en'})}),bundle({'folder/base.apk':apk()})])await assert.rejects(inspectAppPackage(bytes,'Example.psapk'));
});
test('mixed package/version and missing required types cannot publish',async()=>{
 for(const files of [ {'base.apk':apk(),'s.apk':apk({split:'en',package:'other.app'})}, {'base.apk':apk(),'s.apk':apk({split:'en',versionCode:2})}, {'base.apk':apk({requiredSplitTypes:'base__density'}),'s.apk':apk({split:'en'})}])await assert.rejects(inspectAppPackage(bundle(files),'Example.psapk'));
});
test('declared zip bomb is rejected before APK allocation',async()=>{
 const bytes=bundle({'base.apk':apk()});
 const offset=bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x01,0x02]));assert(offset>=0);
 bytes.writeUInt32LE(500_000_001,offset+24);
 await assert.rejects(inspectAppPackage(bytes,'Example.psapk'),/Invalid APK set/);
});
test('more than 100 entries fail and a normal standalone APK remains supported',async()=>{
 const entries={'base.apk':apk()};for(let n=0;n<100;n++)entries[`s${n}.apk`]=apk({split:`s${n}`});
 await assert.rejects(inspectAppPackage(bundle(entries),'Example.psapk'),/Invalid APK set/);
 assert.equal((await inspectAppPackage(Buffer.from(apk()),'Example.apk')).mime,'application/vnd.android.package-archive');
});
