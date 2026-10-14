import { canManage,getCurrentSchool,requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SupportReply } from "@/components/support-reply";
import { dateTime } from "@/lib/format";
import Link from "next/link";
import { RealtimeRefresh } from "@/components/realtime-refresh";
export default async function SupportPage({searchParams}:{searchParams:Promise<{device?:string}>}) {
 const staff=await requireStaff(),school=await getCurrentSchool();if(!school)return <p>Select a school first.</p>;if(!canManage(staff,school.id))redirect('/overview');
 const db=await createClient();const {data:devices}=await db.from('devices').select('id,student_name,student_id').eq('school_id',school.id).order('student_name').limit(2000);
 const {device}=await searchParams;const selected=devices?.find(d=>d.id===device);
 let query=db.from('support_messages').select('*').eq('school_id',school.id).order('created_at',{ascending:false}).limit(200);
 if(selected)query=query.eq('device_id',selected.id);
 const {data:messages,error}=await query;
 return <><RealtimeRefresh table="support_messages" filter={`school_id=eq.${school.id}`}/><PageHeader title="Student support" description="Private support conversations and requests to correct student names."/><form className="card mb-6 flex gap-3 p-4"><select name="device" className="input" defaultValue={selected?.id||''} aria-label="Student"><option value="">All students</option>{devices?.map(d=><option key={d.id} value={d.id}>{d.student_name} · {d.student_id}</option>)}</select><button className="btn-primary">View</button></form>{error&&<p role="alert">{error.message}</p>}<section className="card p-6">{!messages?.length&&<p className="text-sm text-slate-500">No support messages yet.</p>}{[...(messages||[])].reverse().map(m=>{const d=devices?.find(d=>d.id===m.device_id);return <article key={m.id} className={`mb-4 rounded-2xl p-5 ${m.sender==='support'?'bg-brand-50':'bg-slate-50'}`}><div className="flex flex-wrap justify-between gap-3 text-sm"><Link href={`/support?device=${m.device_id}`} className="font-semibold text-brand-700">{m.sender==='support'?'RoboKorda support':d?.student_name||'Student'}{m.category==='name_correction'?' · Name correction':''}</Link><span className="text-xs text-slate-400">{dateTime(m.created_at)}</span></div><p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{m.body}</p>{m.category==='name_correction'&&<Link href={`/devices/${m.device_id}`} className="mt-2 inline-block text-xs text-brand-700 underline">Review student name</Link>}</article>})}{selected?<SupportReply key={selected.id} deviceId={selected.id}/>:<p className="mt-5 text-xs text-slate-400">Choose a student above to reply.</p>}</section></>;
}
