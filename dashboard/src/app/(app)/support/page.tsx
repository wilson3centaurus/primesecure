import { canManage,getCurrentSchool,requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SupportReply } from "@/components/support-reply";
import { SupportActions } from "@/components/support-actions";
import { ReadMessages } from "@/components/notification-bell";
import { dateTime } from "@/lib/format";
import Link from "next/link";
import Image from "next/image";
import { RealtimeRefresh } from "@/components/realtime-refresh";

function SupportPhoto({data}:{data:unknown}) {
 if(typeof data!=="string"||data.length>100000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(data))return null;
 return <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-brand-700">View shared image</summary><Image unoptimized src={data} alt="Image shared in this support conversation" width={640} height={480} className="mt-2 h-auto max-h-96 w-full max-w-xl rounded-lg object-contain"/></details>;
}
export default async function SupportPage({searchParams}:{searchParams:Promise<{device?:string;category?:string}>}) {
 const staff=await requireStaff(),school=await getCurrentSchool();if(!school)return <p>Select a school first.</p>;if(!canManage(staff,school.id))redirect('/overview');
 const db=await createClient();const {device,category}=await searchParams;
 const [{data:devices},{data:reads}]=await Promise.all([db.from('devices').select('id,student_name,student_id').eq('school_id',school.id).order('student_name').limit(2000),db.from('communication_receipts').select('message_id').eq('kind','support')]);
 const selected=devices?.find(d=>d.id===device),readIds=new Set((reads||[]).map(r=>r.message_id));
 let query=db.from('support_messages').select('*').eq('school_id',school.id).order('created_at',{ascending:false}).limit(200);
 if(selected)query=query.eq('device_id',selected.id);
 if(category&&['support','bug_report','name_correction'].includes(category))query=query.eq('category',category);
 const {data:messages,error}=await query;
 return <><RealtimeRefresh table="support_messages" filter={`school_id=eq.${school.id}`}/><PageHeader title="Student support" description="Conversations, screenshots and student bug reports."/>
 <form className="card mb-4 flex flex-wrap items-center gap-3 p-3"><select name="device" className="input max-w-sm" defaultValue={selected?.id||''} aria-label="Student"><option value="">All students</option>{devices?.map(d=><option key={d.id} value={d.id}>{d.student_name} ? {d.student_id}</option>)}</select><select name="category" className="input max-w-xs" defaultValue={category||''} aria-label="Message type"><option value="">All message types</option><option value="support">Support messages</option><option value="bug_report">Bug reports</option><option value="name_correction">Name corrections</option></select><button className="btn-primary">View</button></form>
 {error&&<p role="alert">{error.message}</p>}
 {selected&&<ReadMessages kind="support" ids={(messages||[]).filter(m=>m.sender==='student'&&!m.deleted_at&&!readIds.has(m.id)).map(m=>m.id)}/>}
 <section className="card p-4"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">{selected?.student_name||'Recent support activity'}</h2><span className="text-xs text-muted">Latest {messages?.length||0} messages ? up to 200</span></div>
 {!messages?.length&&<p className="p-4 text-sm text-muted">No support messages yet.</p>}
 {[...(messages||[])].reverse().map(m=>{const d=devices?.find(d=>d.id===m.device_id);const details=m.report_details||{};return <article id={`support-${m.id}`} key={m.id} className={`mb-3 scroll-mt-24 rounded-xl border border-line p-3 ${m.sender==='support'?'bg-brand-50':'bg-panel'}`}><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><Link href={`/support?device=${m.device_id}#support-${m.id}`} className="font-semibold text-brand-700">{m.sender==='support'?'RoboKorda support':d?.student_name||'Student'}</Link><div className="flex items-center gap-2">{m.sender==='student'&&!m.deleted_at&&!readIds.has(m.id)&&!selected&&<span className="rounded-full bg-brand-100 px-2 py-0.5 text-brand-700">New</span>}<time className="text-[10px] text-muted">{dateTime(m.created_at)}</time></div></div>
 {m.category==='bug_report'&&!m.deleted_at&&<p className="mt-2 text-xs font-semibold">Bug report ? {details.category||'Other'} ? {m.report_status}</p>}
 {m.category==='name_correction'&&!m.deleted_at&&<Link href={`/devices/${m.device_id}`} className="mt-2 inline-block text-xs text-brand-700 underline">Review name correction</Link>}
 <p className={`mt-2 whitespace-pre-wrap text-sm ${m.deleted_at?'italic text-muted':''}`}>{m.body}</p>
 {!m.deleted_at&&<><SupportPhoto data={m.attachment_data}/>{m.category==='bug_report'&&<details className="mt-2 text-xs"><summary className="cursor-pointer text-brand-700">Reproduction details</summary><dl className="mt-2 space-y-2">{[['Steps',details.steps],['Expected',details.expected],['What happened',details.actual],['Agent',details.agent_version],['Interface',details.ui_version]].map(([label,value])=>value?<div key={label}><dt className="font-semibold">{label}</dt><dd className="whitespace-pre-wrap text-muted">{value}</dd></div>:null)}</dl></details>}<SupportActions id={m.id} bug={m.category==='bug_report'} status={m.report_status}/></>}
 </article>})}
 {selected?<SupportReply key={selected.id} deviceId={selected.id}/>:<p className="mt-4 text-xs text-muted">Select a student to read the conversation and reply. New messages stay unread until you open their conversation.</p>}
 </section></>;
}
