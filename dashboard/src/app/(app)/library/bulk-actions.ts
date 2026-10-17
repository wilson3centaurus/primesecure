"use server";

import { revalidatePath } from "next/cache";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Input={schoolId:string;ids:string[];action:string;target?:string[]};
export async function bulkNotes(input:Input):Promise<{ok?:string;error?:string;completed:string[]}> {
 const completed:string[]=[];
 const fail=(error:string)=>({error,completed});
 const staff=await requireStaff(),school=await getCurrentSchool();
 if(!input||typeof input!=='object')return fail('Invalid bulk action.');
 if(!school||school.id!==input.schoolId||!canManage(staff,school.id))return fail('Administrator access to the current school is required.');
 if(!Array.isArray(input.ids)||!input.ids.length||input.ids.length>1000||input.ids.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)))return fail('Select between 1 and 1,000 files.');
 if(!['move','copy','enable','disable','publish','withdraw'].includes(input.action))return fail('Choose a bulk action.');
 const ids=[...new Set(input.ids)],target=input.target;
 if(['move','copy'].includes(input.action)&&(!Array.isArray(target)||target.length!==3||target.some((v,n)=>typeof v!=='string'||!v.trim()||v.length>(n===1?100:80)||/[\\/]/.test(v))))return fail('Choose a destination form, subject and resource folder.');
 const db=await createClient();
 type Row={id:string;school_id:string|null;storage_path:string;title:string;description:string;mime_type:string;size:number;published:boolean};
 const rows:Row[]=[];
 // Keep query URLs below proxy limits, including a full-library selection.
 for(let start=0;start<ids.length;start+=80){
  const {data,error}=await db.from('hub_items').select('id,school_id,storage_path,title,description,mime_type,size,published').eq('kind','resource').in('id',ids.slice(start,start+80));
  if(error)return fail(error.message);rows.push(...(data||[]));
 }
 if(rows.length!==ids.length||rows.some(row=>row.school_id!==null&&row.school_id!==school.id))return fail('Some selected files are unavailable in this school. Refresh and select again.');
 if(['enable','disable'].includes(input.action)&&rows.some(row=>row.school_id!==null))return fail('Enable and Disable apply to shared-library files only.');
 if(['move','publish','withdraw'].includes(input.action)&&rows.some(row=>row.school_id===null&&staff.role!=='super_admin'))return fail('Only RoboKorda administrators can change shared originals. Copy them into your school instead.');
 let failure='';
 if(input.action==='copy'){
  for(let start=0;start<rows.length;start+=4){
   await Promise.all(rows.slice(start,start+4).map(async row=>{
    const id=crypto.randomUUID(),path=`${school.id}/${id}/${row.storage_path.split('/').pop()}`;
    try {
     const {error:copyError}=await db.storage.from('primesecure-hub').copy(row.storage_path,path);
     if(copyError){failure=copyError.message;return;}
     const {error}=await db.from('hub_items').insert({id,school_id:school.id,kind:'resource',title:row.title,description:row.description,form_level:target![0],subject:target![1],category:target![2],storage_path:path,mime_type:row.mime_type,size:row.size,published:row.published});
     if(error){await db.storage.from('primesecure-hub').remove([path]);failure=error.message;return;}
     completed.push(row.id);
    } catch { failure='A file could not be copied. Check the library before retrying.'; }
   }));
   if(failure)break;
  }
 }else{
  for(let start=0;start<ids.length;start+=80){
   const batch=ids.slice(start,start+80);
   const result=input.action==='enable'
    ?await db.from('hub_access').upsert(batch.map(item_id=>({item_id,school_id:school.id})))
    :input.action==='disable'?await db.from('hub_access').delete().eq('school_id',school.id).in('item_id',batch)
    :await db.from('hub_items').update(input.action==='move'?{form_level:target![0],subject:target![1],category:target![2]}:{published:input.action==='publish'}).eq('kind','resource').in('id',batch).or(`school_id.is.null,school_id.eq.${school.id}`).select('id');
   if(result.error){failure=result.error.message;break;}
   if(['move','publish','withdraw'].includes(input.action)){const changed=(result.data||[]).map((row:{id:string})=>row.id);completed.push(...changed);if(changed.length!==batch.length){failure='Some files changed or became unavailable. Refresh the library.';break;}}else completed.push(...batch);
  }
 }
 revalidatePath('/library');
 if(failure)return fail(`${completed.length} of ${ids.length} files completed. Remaining files stay selected. ${failure}`);
 return {ok:`${completed.length} file${completed.length===1?'':'s'} ${input.action==='copy'?'copied; originals kept':input.action==='move'?'moved':input.action==='publish'?'republished':input.action==='withdraw'?'withdrawn':input.action==='enable'?'enabled for this school':'disabled for this school'}. Devices receive changes when online.`,completed};
}
