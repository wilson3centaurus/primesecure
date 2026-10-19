// Read-only APK validation; optionally writes verified-byte ZIP wrappers to a NEW output directory.
// This does not upload, uninstall, activate or re-sign any application.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {zipSync} from 'fflate';
const require=createRequire(import.meta.url),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cache=new Map();
function load(file){
 const filename=path.resolve(root,file);if(cache.has(filename))return cache.get(filename);
 const module={exports:{}};
 const source=fs.readFileSync(filename,'utf8').replaceAll('import.meta.url',JSON.stringify(new URL('../src/lib/apk.ts',import.meta.url).href));
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(name=>name==='server-only'?{}:name.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),name+'.ts'))):require(name),module,module.exports);
 cache.set(filename,module.exports);return module.exports;
}
const {inspectAppPackage}=load('src/lib/apk.ts');
const input=process.argv[2],output=process.argv[3];
if(!input)throw Error('Usage: node scripts/audit-phone-packages.mjs <backup folder> [NEW output folder]');
if(output){if(fs.existsSync(output))throw Error('Choose a NEW output folder; existing files are never replaced.');fs.mkdirSync(output,{recursive:true});}
const report=[];
for(const folder of fs.readdirSync(input,{withFileTypes:true}).filter(e=>e.isDirectory())){
 const directory=path.join(input,folder.name);
 try{
  const files=fs.readdirSync(directory,{withFileTypes:true});
  if(files.some(f=>!f.isFile()||!f.name.toLowerCase().endsWith('.apk')))throw Error('Contains non-APK content; manual review required.');
  if(files.reduce((n,f)=>n+fs.statSync(path.join(directory,f.name)).size,0)>500_000_000)throw Error('Complete app exceeds 500 MB.');
  const contents=Object.fromEntries(files.map(f=>[f.name,new Uint8Array(fs.readFileSync(path.join(directory,f.name)))]));
  const archive=Buffer.from(zipSync(contents,{level:0}));
  const name=folder.name.replace(/[^a-zA-Z0-9._-]/g,'_')+'.psapk';
  const app=await inspectAppPackage(archive,name);
  if(output)fs.writeFileSync(path.join(output,name),archive,{flag:'wx'});
  report.push({folder:folder.name,status:'Packaging checks passed; device test still required',package:app.packageName,version:app.version,minSdk:app.minSdk,parts:files.length,bytes:archive.length,sha256:createHash('sha256').update(archive).digest('hex')});
 }catch(e){report.push({folder:folder.name,status:'Needs attention',error:e.message});}
 console.log(JSON.stringify(report.at(-1)));
}
if(output)fs.writeFileSync(path.join(output,'compatibility-report.json'),JSON.stringify(report,null,2),{flag:'wx'});
