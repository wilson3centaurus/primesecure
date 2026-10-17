"use server";
import {revalidatePath} from 'next/cache';
import {canManage,getCurrentSchool,requireStaff} from '@/lib/auth';
import {createClient} from '@/lib/supabase/server';
import {MEDIA_CATEGORIES,mediaChannels,youtubeId} from '@/lib/prime-media';
import type {FormState} from '@/lib/types';
export async function savePrimeMedia(_prev:FormState,form:FormData):Promise<FormState>{
 const staff=await requireStaff(),school=await getCurrentSchool();if(!school||!canManage(staff,school.id))return {error:'Administrator access required.'};
 const channels=mediaChannels(String(form.get('channels')||''));if(!channels)return {error:'Enter up to 20 channel IDs, one per line: UC… | Channel name.'};
 const {error}=await (await createClient()).from('prime_media_settings').upsert({school_id:school.id,enabled:form.get('enabled')==='on',youtube_search:form.get('youtube_search')==='on',channels});
 if(error)return {error:error.message};revalidatePath('/library');return {ok:'Prime Media settings saved. Devices receive them through sync.'};
}
export async function addPrimeVideo(_prev:FormState,form:FormData):Promise<FormState>{
 const staff=await requireStaff(),school=await getCurrentSchool();if(!school||!canManage(staff,school.id))return {error:'Administrator access required.'};
 const db=await createClient(),action=String(form.get('action')||'add');
 if(action==='delete'){
  const {error}=await db.from('prime_media_videos').delete().eq('id',String(form.get('id'))).eq('school_id',school.id);if(error)return {error:error.message};
 }else{
  const video_id=youtubeId(String(form.get('url')||'')),title=String(form.get('title')||'').trim(),channel=String(form.get('channel')||'').trim(),category=String(form.get('category')||'Learning');
  if(!video_id||!title||title.length>160||channel.length>160||!MEDIA_CATEGORIES.some(c=>c===category))return {error:'Enter a YouTube video link, title and category.'};
  const {error}=await db.from('prime_media_videos').upsert({school_id:school.id,video_id,title,channel,category},{onConflict:'school_id,video_id'});if(error)return {error:error.message};
 }
 revalidatePath('/library');return {ok:action==='delete'?'Video removed from the school collection.':'Video added to the school collection.'};
}
