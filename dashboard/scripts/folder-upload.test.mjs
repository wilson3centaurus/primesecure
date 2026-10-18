import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/lib/folder-upload.ts',import.meta.url),'utf8');
const mod={exports:{}};
new Function('module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(mod,mod.exports);
const options={kind:'resource',form:'Explore & grow',subject:'',category:'',shared:false,title:'',description:'',preinstall:false};
test('whole folders keep their names and file titles at the current location',()=>{
 const result=mod.exports.folderUploadOptions({name:'How a motor works.jpg',webkitRelativePath:'Robotics/How a motor works.jpg'},options);
 assert.equal(result.form,'Explore & grow');assert.equal(result.subject,'Robotics');assert.equal(result.category,'');assert.equal(result.title,'How a motor works.jpg');
});
test('nested folders are retained rather than flattened',()=>{
 const result=mod.exports.folderUploadOptions({name:'Motor.jpg',webkitRelativePath:'Robotics/Motors/Motor.jpg'},options);
 assert.equal(result.subject,'Robotics');assert.equal(result.category,'Motors');
});
test('too-deep and traversal paths fail before files are queued',()=>{
 for(const path of ['Robotics/Motors/Parts/Motor.jpg','../outside.jpg','Robotics/./Motor.jpg','Robotics//Motor.jpg'])
  assert.throws(()=>mod.exports.folderUploadOptions({name:'Motor.jpg',webkitRelativePath:path},options));
});
test('ordinary files and non-resource uploads keep existing metadata',()=>{
 assert.equal(mod.exports.folderUploadOptions({name:'a.jpg',webkitRelativePath:''},options),options);
 const app={...options,kind:'app'};assert.equal(mod.exports.folderUploadOptions({name:'a.apk',webkitRelativePath:'Apps/a.apk'},app),app);
});
