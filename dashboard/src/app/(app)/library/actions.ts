"use server";

import { revalidatePath } from "next/cache";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/types";
import {MEDIA_MIMES} from "@/lib/prime-media";
import { inspectApk } from "@/lib/apk";

export async function publishItem(input: { kind: string; title: string; description: string; form: string; subject: string; category: string; path: string; mime: string; size: number; packageName?: string; shared: boolean; preinstall: boolean; schoolId?:string;uploadId?:string }): Promise<FormState> {
  const staff = await requireStaff();
  // Background uploads keep their original school even after the workspace changes.
  const school = input.schoolId ? {id:input.schoolId} : await getCurrentSchool();
  if (!school || !canManage(staff, school.id) || (input.shared && staff.role !== "super_admin")) return { error: "Administrator access required." };
  const prefix = input.shared ? "shared" : school.id;
  if (!input.path.startsWith(`${prefix}/`) || input.path.includes("..") || !["resource", "wallpaper", "app", "media"].includes(input.kind)) return { error: "Invalid upload." };
  if ((!input.title.trim() && input.kind!=="app") || input.title.length > 160 || input.description.length > 2000) return { error: "Enter a title of up to 160 characters and description of up to 2,000." };
  if (input.kind === "wallpaper" && !["image/jpeg", "image/png", "image/webp"].includes(input.mime)) return { error: "Wallpapers must be JPG, PNG or WebP." };
  if(input.kind==="media"&&(!MEDIA_MIMES.includes(input.mime)||input.size>250_000_000))return {error:"Choose MP3, M4A, OGG, WAV, MP4 or WebM smaller than 250 MB."};
  const supabase = await createClient();
  const matches=(row:{storage_path:string;school_id:string|null;kind:string})=>row.storage_path===input.path&&row.school_id===(input.shared?null:school.id)&&row.kind===input.kind;
  if(input.uploadId){
    if(!/^[0-9a-f-]{36}$/i.test(input.uploadId)||!input.path.startsWith(`${prefix}/${input.uploadId}/`))return {error:'Invalid upload identity.'};
    const {data:existing,error}=await supabase.from('hub_items').select('storage_path,school_id,kind').eq('id',input.uploadId).maybeSingle();
    if(error)return {error:error.message};
    if(existing)return matches(existing)?{ok:'Already published to the library.'}:{error:'Upload identity is already in use.'};
  }
  const slash = input.path.lastIndexOf("/");
  const { data: files, error: fileError } = await supabase.storage.from("primesecure-hub").list(input.path.slice(0, slash), { search: input.path.slice(slash + 1) });
  const uploaded = files?.find(f => f.name === input.path.slice(slash + 1));
  if (fileError || !uploaded || Number(uploaded.metadata?.size) !== input.size) return { error: "Upload could not be verified. Please upload again." };
  let apk: Awaited<ReturnType<typeof inspectApk>> | undefined;
  if(input.kind==="app") {
    if(input.size>250_000_000)return {error:"Choose an APK smaller than 250 MB."};
    const {data:blob,error:downloadError}=await supabase.storage.from("primesecure-hub").download(input.path);
    if(downloadError || !blob)return {error:downloadError?.message||"Could not read APK."};
    try { apk=await inspectApk(Buffer.from(await blob.arrayBuffer()),input.path.slice(slash+1)); }
    catch(e){return {error:e instanceof Error?e.message:"Could not inspect APK."};}
  }
  const { error } = await supabase.from("hub_items").insert({
    ...(input.uploadId?{id:input.uploadId}:{}),
    school_id: input.shared ? null : school.id, kind: input.kind, title: (input.title.trim()||apk?.title||"App").slice(0,160), description: input.description,
    form_level: input.form.slice(0, 80), subject: input.subject.slice(0, 100), category: input.category.slice(0, 80),
    storage_path: input.path, mime_type: input.mime, size: input.size,
    package_name: apk?.packageName || null, preinstall: input.kind === "app" && input.preinstall,
    version_name:apk?.version,icon_data:apk?.icon,sha256:apk?.sha256,
  });
  if (error) {
    if(error.code==='23505'&&input.uploadId){
      const {data:existing}=await supabase.from('hub_items').select('storage_path,school_id,kind').eq('id',input.uploadId).maybeSingle();
      if(existing&&matches(existing))return {ok:'Already published to the library.'};
    }
    return { error: error.message };
  }
  revalidatePath("/library"); revalidatePath("/wallpapers"); revalidatePath("/apps");
  return { ok: input.shared ? "Published to RoboKorda library. Enable it for the schools that should receive it." : "Published. Devices download content on their next online sync." };
}

export async function changeLibraryItem(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff(); const school = await getCurrentSchool();
  if (!school || !canManage(staff, school.id)) return { error: "Administrator access required." };
  const supabase = await createClient(); const id = String(form.get("id")); const action = String(form.get("action"));
  const { data: item } = await supabase.from("hub_items").select("id,school_id,published").eq("id", id).maybeSingle();
  if (!item) return { error: "Item not found." };
  let error;
  if (action === "enable" && item.school_id === null) ({ error } = await supabase.from("hub_access").upsert({ item_id: id, school_id: school.id }));
  else if (action === "disable" && item.school_id === null) ({ error } = await supabase.from("hub_access").delete().eq("item_id", id).eq("school_id", school.id));
  else if (action === "publish" && (staff.role === "super_admin" || item.school_id === school.id)) ({ error } = await supabase.from("hub_items").update({ published: !item.published }).eq("id", id));
  else return { error: "Not allowed." };
  if (error) return { error: error.message };
  revalidatePath("/library"); revalidatePath("/wallpapers"); revalidatePath("/apps");
  return { ok: "Saved. Devices receive changes at the next sync." };
}

export async function saveHubSettings(_prev: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff(); const school = await getCurrentSchool();
  const global = form.get("global") === "on";
  if (!school || !canManage(staff, school.id) || (global && staff.role !== "super_admin")) return { error: "Administrator access required." };
  const supabase = await createClient(); const wallpaper = String(form.get("wallpaper") || "");
  if (wallpaper) {
    const { data: item } = await supabase.from("hub_items").select("id,school_id,kind,published").eq("id", wallpaper).maybeSingle();
    if (!item || item.kind !== "wallpaper" || !item.published || (global ? item.school_id !== null : item.school_id !== null && item.school_id !== school.id)) return { error: "Choose a published wallpaper in this scope." };
  }
  const { error } = await supabase.from("hub_settings").upsert({ scope: global ? "global" : school.id, school_id: global ? null : school.id,
    default_wallpaper_id: wallpaper || null, allow_wallpaper_choice: form.get("allow_choice") === "on", hide_vendor_store: form.get("hide_vendor_store") === "on" });
  if (error) return { error: error.message };
  revalidatePath("/settings"); revalidatePath("/library"); revalidatePath("/wallpapers"); return { ok: global ? "Master defaults saved for all schools without an override." : "School defaults saved." };
}

export async function reviewAppRequest(_prev: FormState, form: FormData): Promise<FormState> {
  await requireStaff(); const supabase = await createClient();
  const status = String(form.get("status"));
  if (!["reviewing", "approved", "declined"].includes(status)) return { error: "Invalid status." };
  const { data, error } = await supabase.from("hub_requests").update({ status }).eq("id", String(form.get("id"))).select("id");
  if (error || !data?.length) return { error: error?.message || "You cannot review this request." };
  revalidatePath("/apps"); revalidatePath("/requests"); revalidatePath("/library"); return { ok: "Request status updated. Add approved materials to the library so students can download them." };
}


export async function manageNotesFolder(_prev: FormState, form: FormData): Promise<FormState> {
 const staff=await requireStaff(),school=await getCurrentSchool();
 if(!school||!canManage(staff,school.id))return {error:'Administrator access required.'};
 let path:unknown;try{path=JSON.parse(String(form.get('path')||'[]'));}catch{return {error:'Invalid folder.'};}
 if(!Array.isArray(path)||path.some(p=>typeof p!=='string'))return {error:'Invalid folder.'};
 if(form.get('action')==='create')path[path.length-1]=String(form.get('name')||'').trim();
 const db=await createClient();
 let target:unknown;
 if(form.get('action')==='move'){
  try{target=JSON.parse(String(form.get('target')||'[]'));}catch{return {error:'Choose a destination folder.'};}
  if(!Array.isArray(target)||target.length!==path.length||target.some(v=>typeof v!=='string'))return {error:'Choose a destination at the same folder level.'};
 }
 const {error}=form.get('action')==='move'
  ?await db.rpc('staff_move_library_folder',{p_school:school.id,p_shared:form.get('shared')==='on',p_path:path,p_target:target})
  :await db.rpc('staff_library_folder',{p_school:school.id,p_shared:form.get('shared')==='on',p_action:String(form.get('action')),p_path:path,p_name:String(form.get('name')||'')});
 if(error)return {error:error.message};revalidatePath('/library');return {ok:'Folder saved.'};
}

export async function organiseNoteFile(_prev: FormState, form: FormData): Promise<FormState> {
 const staff=await requireStaff(),school=await getCurrentSchool();
 if(!school||!canManage(staff,school.id))return {error:'Administrator access required.'};
 const action=String(form.get('action')),id=String(form.get('id'));
 let target:unknown;try{target=JSON.parse(String(form.get('target')||'[]'));}catch{return {error:'Choose a destination folder.'};}
 if(!Array.isArray(target)||(target.length<1||target.length>3)||target.some((v,n)=>typeof v!=='string'||!v.trim()||v.length>(n===1?100:80)||/[\\/]/.test(v)))return {error:'Choose a destination folder.'};
 const [form_level,subject='',category='']=target as string[];
 const db=await createClient();
 const {data:item,error:readError}=await db.from('hub_items').select('*').eq('id',id).eq('kind','resource').maybeSingle();
 if(readError||!item)return {error:readError?.message||'Resource not found.'};
 if(action==='move'){
  if(item.school_id!==school.id&&!(item.school_id===null&&staff.role==='super_admin'))return {error:'Only RoboKorda admins can move shared resources. You can copy one into your school.'};
  const {error}=await db.from('hub_items').update({form_level,subject,category}).eq('id',id).select('id').single();
  if(error)return {error:error.message};
 }else if(action==='copy'){
  const copyId=crypto.randomUUID(),path=`${school.id}/${copyId}/${item.storage_path.split('/').pop()}`;
  const {error:copyError}=await db.storage.from('primesecure-hub').copy(item.storage_path,path);
  if(copyError)return {error:copyError.message};
  const {error}=await db.from('hub_items').insert({id:copyId,school_id:school.id,kind:'resource',title:item.title,description:item.description,form_level,subject,category,storage_path:path,mime_type:item.mime_type,size:item.size,published:item.published});
  if(error){await db.storage.from('primesecure-hub').remove([path]);return {error:error.message};}
 }else return {error:'Choose move or copy.'};
 revalidatePath('/library');return {ok:action==='copy'?'Copied into your school library. Original kept.':'Moved. Devices receive the new folder at their next sync.'};
}
