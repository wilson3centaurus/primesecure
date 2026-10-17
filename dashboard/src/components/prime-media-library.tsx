import {canManage,getCurrentSchool,requireStaff} from '@/lib/auth';
import {createClient} from '@/lib/supabase/server';
import {HubItemAction,HubUpload} from './hub-forms';
import {PrimeMediaSettings,PrimeVideoForm,RemovePrimeVideo} from './prime-media-forms';
import {PageHeader} from './page-header';
import {Film,Music2,Play,CloudDownload} from 'lucide-react';
export async function PrimeMediaLibrary(){
 const staff=await requireStaff(),school=await getCurrentSchool();if(!school)return <PageHeader title="Prime Media" description="Choose a school first."/>;
 const db=await createClient(),manager=canManage(staff,school.id);
 const [{data:settings,error:settingsError},{data:videos,error:videoError},{data:files,error:fileError},{data:access}]=await Promise.all([
  db.from('prime_media_settings').select('*').eq('school_id',school.id).maybeSingle(),db.from('prime_media_videos').select('*').eq('school_id',school.id).order('title'),
  db.from('hub_items').select('id,title,mime_type,size,published,school_id').eq('kind','media').or(`school_id.is.null,school_id.eq.${school.id}`).order('title'),db.from('hub_access').select('item_id').eq('school_id',school.id)]);
 const enabled=new Set((access||[]).map(a=>a.item_id));
 return <section className="space-y-5"><PageHeader title="Prime Media" description="One school collection. Watch online, or download approved files for offline playback."/>
 {(settingsError||videoError||fileError)&&<p role="alert" className="card p-4 text-red-600">Could not load Prime Media. {settingsError?.message||videoError?.message||fileError?.message}</p>}
 {manager&&<div className="grid gap-4 xl:grid-cols-2"><details className="card p-4" open><summary className="mb-4 cursor-pointer text-sm font-semibold">Media controls</summary><PrimeMediaSettings settings={settings} keyReady={!!process.env.YOUTUBE_API_KEY}/></details><details className="card p-4"><summary className="mb-4 cursor-pointer text-sm font-semibold">Add a YouTube video</summary><PrimeVideoForm/><p className="mt-4 text-[11px] text-muted">Uses the official online player. Some videos cannot be embedded, may require age verification or may contain YouTube ads. No YouTube-to-MP3/MP4 conversion.</p></details></div>}
 {manager&&<details className="card p-4"><summary className="mb-4 cursor-pointer text-sm font-semibold">Upload downloadable music & videos</summary><p className="mb-4 text-xs text-muted">Upload files you own or have permission to distribute. MP3, M4A, OGG, WAV, MP4 or WebM; up to 250 MB per file. Students choose what to download; these files do not automatically fill their storage.</p><HubUpload kind="media" schoolId={school.id} superAdmin={staff.role==='super_admin'}/></details>}
 <div className="flex items-center gap-2 text-sm font-semibold"><Play size={16}/>Watch online <span className="text-xs font-normal text-muted">{videos?.length||0} approved videos</span></div>
 <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{(videos||[]).map(v=><article key={v.id} className="card flex items-start gap-3 p-4"><Film size={22} className="shrink-0 text-brand-500"/><div className="min-w-0 flex-1"><h2 className="text-xs font-semibold">{v.title}</h2><p className="my-2 text-[11px] text-muted">{v.channel||'YouTube'} · {v.category}</p>{manager&&<RemovePrimeVideo id={v.id}/>}</div></article>)}</div>
 {!videos?.length&&<p className="card p-5 text-xs text-muted">Add approved videos above. Students can search your collection without a YouTube API key.</p>}
 <div className="flex items-center gap-2 text-sm font-semibold"><CloudDownload size={16}/>Download & keep <span className="text-xs font-normal text-muted">{files?.length||0} files</span></div>
 <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{(files||[]).map(f=><article key={f.id} className="card flex items-start gap-3 p-4">{f.mime_type.startsWith('audio/')?<Music2 size={22} className="shrink-0 text-emerald-600"/>:<Film size={22} className="shrink-0 text-brand-500"/>}<div className="min-w-0 flex-1"><h2 className="text-xs font-semibold">{f.title}</h2><p className="my-2 text-[11px] text-muted">{(f.size/1048576).toFixed(1)} MB · {f.published&&(f.school_id||enabled.has(f.id))?'Available':'Not available'}</p><div className="flex flex-wrap gap-2">{manager&&!f.school_id&&<HubItemAction id={f.id} action={enabled.has(f.id)?'disable':'enable'}>{enabled.has(f.id)?'Disable':'Enable'}</HubItemAction>}{manager&&(staff.role==='super_admin'||f.school_id===school.id)&&<HubItemAction id={f.id} action="publish">{f.published?'Withdraw':'Republish'}</HubItemAction>}</div></div></article>)}</div>
 </section>;
}
