import "server-only";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { unzipSync } from "fflate";

type Manifest = { package: string; versionName?: string; versionCode?: number; usesSdk?: {minSdkVersion?: number}; application?: {label?: string; icon?: string} };
const require = createRequire(import.meta.url);
const ApkReader = require("@devicefarmer/adbkit-apkreader") as {open(buffer: Buffer): Promise<{readManifest(): Promise<Manifest>}>};

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
  if(bytes.length>250_000_000)throw new Error("This APK exceeds the 250 MB limit.");
  if(bytes[0]!==0x50 || bytes[1]!==0x4b)throw new Error("This file is not an APK. Choose the original .apk file.");
  const reader=await ApkReader.open(bytes), manifest=await reader.readManifest();
  if(!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(manifest.package))throw new Error("APK has no valid application identifier.");
  const files=unzipSync(bytes,{filter:entry=>entry.name==="resources.arsc" || (/^res\/.+\.(png|webp|jpg)$/.test(entry.name) && entry.originalSize<=200000)});
  const resources=files['resources.arsc']?resourceStrings(files['resources.arsc']):new Map<number,string>();
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
