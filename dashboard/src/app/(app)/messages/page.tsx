import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { MessageForm } from "@/components/message-form";
import { MessageHistory, type Notice } from "@/components/message-history";
import { dateTime } from "@/lib/format";
type Batch={id:string;created_by:string;created_at:string;title:string;body:string;receipts:{id:string;device_id:string;name:string;student_id:string;status:string;seen_at:string|null;acknowledged_at:string|null}[]};

export default async function MessagesPage() {
  const staff=await requireStaff(), school=await getCurrentSchool();
  if(!school)return <PageHeader title="Messages" description="Select a school first."/>;
  const db=await createClient();
  const [{data,error},{data:replies,error:replyError},{data:devices},{data:groups}]=await Promise.all([
    db.rpc("staff_message_history",{p_school_id:school.id}),
    db.from("message_replies").select("*,commands!inner(deleted_at)").eq("school_id",school.id).is("commands.deleted_at",null).order("created_at",{ascending:false}).limit(200),
    db.from("devices").select("id,student_name,student_id").eq("school_id",school.id),
    db.from("school_classes").select("form_level,class_name").eq("school_id",school.id)
  ]);
  const {data:reads}=await db.from("communication_receipts").select("message_id").eq("kind","reply");
  const readIds=new Set((reads||[]).map(r=>r.message_id));
  const names=new Map((devices||[]).map(d=>[d.id,d]));
  const batches=(data||[]) as Batch[];
  const notices:Notice[]=batches.map(batch=>({id:batch.id,title:batch.title,body:batch.body,time:dateTime(batch.created_at),canDelete:canManage(staff,school.id)||batch.created_by===staff.id,receipts:batch.receipts.map(m=>({id:m.id,name:m.name||"Student",studentId:m.student_id||"",opened:m.seen_at?dateTime(m.seen_at):"",acknowledged:m.acknowledged_at?dateTime(m.acknowledged_at):"",status:m.status}))}));
  return <div className="space-y-5"><PageHeader title="Messages" description="School notices, student replies and delivery receipts."/>
    <div className="flex flex-wrap gap-5 text-xs text-slate-500"><span>{notices.length} recent notices (up to 25)</span><span>{batches.reduce((n,b)=>n+b.receipts.filter(r=>r.seen_at).length,0)} opened</span><span>{batches.reduce((n,b)=>n+b.receipts.filter(r=>r.acknowledged_at).length,0)} acknowledged</span><span>{replies?.length||0} replies</span></div>
    <details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-brand-700">+ New message</summary><div className="mt-4 max-w-2xl"><MessageForm target="school" groups={groups||[]}/></div></details>
    {(error||replyError)&&<p role="alert" className="text-sm text-red-600">{error?.message||replyError?.message}</p>}
    <MessageHistory notices={notices} replies={(replies||[]).map(r=>({id:r.id,unread:!readIds.has(r.id),deviceId:r.device_id,name:names.get(r.device_id)?.student_name||"Student",anonymous:r.anonymous,time:dateTime(r.created_at),body:r.body}))}/>
  </div>;
}
