import "server-only";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { unzipSync } from "fflate";
import { APK_MAX_BYTES } from "./upload-limits";
import { APK_PART_NAME, APK_SET_MIME, validateApkParts, type ApkPart } from './apk-set-validation';

type Manifest = { package: string; versionName?: string; versionCode?: number; usesSdk?: {minSdkVersion?: number}; application?: {label?: string; icon?: string} };
const loadApkModule = createRequire(import.meta.url);
const ApkReader = loadApkModule("@devicefarmer/adbkit-apkreader") as {open(buffer: Buffer): Promise<{readManifest(): Promise<Manifest>}>};
type XmlNode = {nodeName:string;attributes:{name:string;typedValue:{value:unknown}}[];childNodes:XmlNode[]};
const BinaryXml = loadApkModule('@devicefarmer/adbkit-apkreader/lib/apkreader/parser/binaryxml') as new (buffer:Buffer)=>{parse():XmlNode};
const attrs=(node?:XmlNode):Record<string,unknown>=>Object.fromEntries((node?.attributes||[]).map(a=>[a.name,a.typedValue.value]));
const types=(value:unknown)=>typeof value==='string'?value.split(',').map(s=>s.trim()).filter(Boolean):[];

function apkPart(bytes:Buffer,name:string):ApkPart {
  if(!bytes.length || bytes.length>APK_MAX_BYTES)throw new Error('Every APK must be non-empty and 500 MB or less.');
  let manifestCount=0;
  const files=unzipSync(bytes,{filter:entry=>{
    if(entry.name!=='AndroidManifest.xml')return false;
    if(++manifestCount>1||entry.originalSize>2_000_000)throw new Error('APK manifest is duplicated or too large.');
    return true;
  }});
  if(!files['AndroidManifest.xml'])throw new Error('APK has no AndroidManifest.xml.');
  const root=new BinaryXml(Buffer.from(files['AndroidManifest.xml'])).parse(),a=attrs(root);
  const app=root.childNodes.find(n=>n.nodeName==='application'), sdk=attrs(root.childNodes.find(n=>n.nodeName==='uses-sdk'));
  const meta=app?.childNodes.filter(n=>n.nodeName==='meta-data').map(attrs)||[];
  const code=Number(a.versionCode),major=Number(a.versionCodeMajor||0);
  return {name,packageName:String(a.package||''),versionCode:Number.isSafeInteger(code)&&code>=0&&Number.isSafeInteger(major)&&major>=0?String((BigInt(major)<<BigInt(32))+BigInt(code)):'invalid',
    split:String(a.split||''),minSdk:sdk.minSdkVersion===undefined?1:Number(sdk.minSdkVersion),requiredTypes:types(a.requiredSplitTypes),splitTypes:types(a.splitTypes),
    requiresSplits:attrs(app).isSplitRequired===true||meta.some(m=>m.name==='com.android.vending.splits.required'&&(m.value===true||m.value===1)),
    dependencies:root.childNodes.filter(n=>n.nodeName==='uses-split').map(n=>String(attrs(n).name||'')).filter(Boolean),configForSplit:String(a.configForSplit||'')};
}

/** ZIP wrapper only: publisher-signed APK bytes are never changed or re-signed. */
export async function inspectAppPackage(bytes:Buffer,filename:string) {
  if(bytes.length>APK_MAX_BYTES)throw new Error('Choose an app package of 500 MB or less.');
  if(!filename.toLowerCase().endsWith('.psapk')) {
    if(!filename.toLowerCase().endsWith('.apk'))throw new Error('Choose .apk or a PrimeSecure .psapk package.');
    validateApkParts([apkPart(bytes,filename)],false);
    return {...await inspectApk(bytes,filename),mime:'application/vnd.android.package-archive'};
  }
  const entries:{name:string;size:number}[]=[],names=new Set<string>();let size=0;
  // Preflight the central directory BEFORE allocating/decompressing any APK entry.
  unzipSync(bytes,{filter:e=>{
    size+=e.originalSize;
    if(!APK_PART_NAME.test(e.name)||names.has(e.name.toLowerCase())||!e.originalSize||size>APK_MAX_BYTES||entries.length>=100)throw new Error('Invalid APK set: use only 1–100 root-level APKs, including base.apk, totaling at most 500 MB.');
    names.add(e.name.toLowerCase());entries.push({name:e.name,size:e.originalSize});return false;
  }});
  if(!entries.some(e=>e.name==='base.apk'))throw new Error('App folder must contain base.apk.');
  const parts:ApkPart[]=[];
  // Read one part at a time, keeping large packages within the server memory budget.
  for(const entry of entries) {
    const file=unzipSync(bytes,{filter:e=>e.name===entry.name})[entry.name];
    if(file.length!==entry.size)throw new Error('APK set contains an invalid file size.');
    parts.push(apkPart(Buffer.from(file.buffer,file.byteOffset,file.byteLength),entry.name));
  }
  validateApkParts(parts,true);
  const base=unzipSync(bytes,{filter:e=>e.name==='base.apk'})['base.apk'];
  return {...await inspectApk(Buffer.from(base.buffer,base.byteOffset,base.byteLength),filename.replace(/\.psapk$/i,'.apk')),
    sha256:createHash('sha256').update(bytes).digest('hex'),mime:APK_SET_MIME};
}

// Resolve simple string/file references from Android's compiled resource table.
function resourceStrings(buffer: Uint8Array): Map<number,string> {
  const view=new DataView(buffer.buffer,buffer.byteOffset,buffer.byteLength), text=new TextDecoder();
  const result=new Map<number,string>(); let strings:string[]=[];
  function pool(offset:number):string[] {
    const count=view.getUint32(offset+8,true), flags=view.getUint32(offset+16,true), start=view.getUint32(offset+20,true), header=view.getUint16(offset+2,true);
    if(count>100000 || start>=buffer.length) return [];
    return Array.from({length:count},(_,n)=>{
      let p=offset+start+view.getUint32(offset+header+n*4,true);
      if(flags&256) {
        if(buffer[p]&128)p+=2;else p++;
        let len=buffer[p++];if(len&128)len=((len&127)<<8)|buffer[p++];
        return text.decode(buffer.subarray(p,p+len));
      }
      let len=view.getUint16(p,true);p+=2;if(len&32768){len=((len&32767)<<16)|view.getUint16(p,true);p+=2;}
      return new TextDecoder("utf-16le").decode(buffer.subarray(p,p+len*2));
    });
  }
  for(let chunk=view.getUint16(2,true);chunk+8<=buffer.length;) {
    const type=view.getUint16(chunk,true), size=view.getUint32(chunk+4,true), header=view.getUint16(chunk+2,true);
    if(size<8 || chunk+size>buffer.length)break;
    if(type===1) strings=pool(chunk);
    if(type===0x200) {
      const packageId=view.getUint32(chunk+8,true), typeOffset=header>=288?view.getUint32(chunk+284,true):0;
      for(let t=chunk+header;t+8<=chunk+size;) {
        const ts=view.getUint32(t+4,true), th=view.getUint16(t+2,true);
        if(ts<8 || t+ts>chunk+size)break;
        if(view.getUint16(t,true)===0x201 && buffer[t+9]===0) {
          const id=buffer[t+8]+typeOffset,count=view.getUint32(t+12,true), start=view.getUint32(t+16,true);
          if(count<=65536 && th+count*4<=ts)for(let n=0;n<count;n++) {
            const off=view.getUint32(t+th+n*4,true);if(off===0xffffffff)continue;
            const e=t+start+off;if(e+16>t+ts || view.getUint16(e+2,true)&1)continue;
            const v=e+view.getUint16(e,true);
            if(v+8>t+ts)continue;
            const dataType=buffer[v+3], data=view.getUint32(v+4,true), key=(packageId<<24)|(id<<16)|n;
            if(dataType===3 && strings[data] && !result.has(key>>>0))result.set(key>>>0,strings[data]);
          }
        }
        t+=ts;
      }
    }
    chunk+=size;
  }
  return result;
}
export async function inspectApk(bytes: Buffer,filename: string) {
  if(bytes.length>APK_MAX_BYTES)throw new Error("This APK exceeds the 500 MB limit.");
  if(bytes[0]!==0x50 || bytes[1]!==0x4b)throw new Error("This file is not an APK. Choose the original .apk file.");
  const reader=await ApkReader.open(bytes), manifest=await reader.readManifest();
  if(!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(manifest.package))throw new Error("APK has no valid application identifier.");
  let selectedBytes=0;
  const files=unzipSync(bytes,{filter:entry=>{
    const selected=(entry.name==='resources.arsc' && entry.originalSize<=32_000_000)||(/^res\/.+\.(png|webp|jpg)$/.test(entry.name)&&entry.originalSize<=200000);
    if(selected)selectedBytes+=entry.originalSize;
    if(selectedBytes>40_000_000)throw new Error('APK icon resources exceed the inspection limit.');
    return selected;
  }});
  let resources=new Map<number,string>();
  // An unsupported resource-table variant must not mislabel a valid app as corrupt.
  try{if(files['resources.arsc'])resources=resourceStrings(files['resources.arsc']);}catch{}
  const resolve=(value?:string)=>value?.startsWith('resourceId:')?resources.get(Number(value.split(':')[1])):value;
  const label=resolve(manifest.application?.label);
  let icon=resolve(manifest.application?.icon);
  if(!icon || !files[icon])icon=Object.keys(files).find(p=>/\/(ic_launcher|app_icon|launcher|primebook)[^/]*\.(png|webp|jpg)$/.test(p));
  return {
    packageName:manifest.package,version:String(manifest.versionName||manifest.versionCode||''),
    title:label && !label.startsWith('resourceId:')?label:filename.replace(/\.apk$/i,'').replace(/[_-]/g,' '),
    icon:icon&&files[icon]?`data:image/${icon.endsWith('.webp')?'webp':icon.endsWith('.jpg')?'jpeg':'png'};base64,${Buffer.from(files[icon]).toString('base64')}`:null,
    sha256:createHash('sha256').update(bytes).digest('hex'),minSdk:manifest.usesSdk?.minSdkVersion||0,
  };
}
