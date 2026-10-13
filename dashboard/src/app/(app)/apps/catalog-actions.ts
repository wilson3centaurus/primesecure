"use server";
import {canManage,getCurrentSchool,requireStaff} from "@/lib/auth";
import {createClient} from "@/lib/supabase/server";
import catalog from "@/data/app-catalog.json";
import type {FormState} from "@/lib/types";
export async function addCatalogApp(id:string,preinstall:boolean):Promise<NonNullable<FormState>&{jobId?:string}> {
 const staff=await requireStaff(),school=await getCurrentSchool();
 if(!school||!canManage(staff,school.id))return {error:'School administrator access required.'};
 const item=catalog.apps.find(a=>a.id===id);if(!item)return {error:'App not found in the verified catalog.'};
 if(Date.now()-catalog.timestamp>14*86400000)return {error:'This catalog needs refreshing. Contact RoboKorda or upload an authorized APK.'};
 const db=await createClient();
 const {data:existing}=await db.from('hub_items').select('id').eq('school_id',school.id).eq('package_name',id).eq('published',true).limit(1);
 if(existing?.length)return {ok:`${item.title} is already in your school library.`};
 const {data:pending}=await db.from('app_imports').select('id').eq('school_id',school.id).eq('package_id',id).in('status',['queued','downloading']).limit(1);
 if(pending?.length)return {ok:`${item.title} is already queued.`,jobId:pending[0].id};
 const {count}=await db.from('app_imports').select('id',{head:true,count:'exact'}).eq('school_id',school.id).gte('created_at',new Date(Date.now()-86400000).toISOString());
 if((count||0)>=50)return {error:'This school has reached 50 catalog imports today. Try tomorrow or upload an authorized APK.'};
 const {data,error}=await db.from('app_imports').insert({school_id:school.id,package_id:id,preinstall:preinstall===true,created_by:staff.id}).select('id').single();
 if(error)return {error:error.message};
 return {ok:`${item.title} queued. The server will download, verify and publish it.`,jobId:data.id};
}
export async function getCatalogImports() {
 const staff=await requireStaff(),school=await getCurrentSchool();if(!school||!canManage(staff,school.id))return [];
 const db=await createClient();const {data}=await db.from('app_imports').select('id,package_id,status,detail,created_at').eq('school_id',school.id).order('created_at',{ascending:false}).limit(20);
 return (data||[]).map(j=>({...j,title:catalog.apps.find(a=>a.id===j.package_id)?.title||'Selected app'}));
}
