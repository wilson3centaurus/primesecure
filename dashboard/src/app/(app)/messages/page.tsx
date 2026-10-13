import { getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { MessageForm } from "@/components/message-form";
import { dateTime } from "@/lib/format";
export default async function MessagesPage() {
  await requireStaff(); const school = await getCurrentSchool();
  if (!school) return <PageHeader title="Messages" description="Select a school first." />;
  const supabase = await createClient();
  const { data, error } = await supabase.from("commands").select("id,payload,status,created_at,acknowledged_at,devices(student_name)").eq("school_id", school.id).eq("type", "message").order("created_at", { ascending: false }).limit(200);
  return <><PageHeader title="School messages" description="Reach every Primebook. Track delivery separately from student acknowledgement." />
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_1.2fr]"><section className="card p-6"><h2 className="mb-4 text-lg font-semibold">Send to {school.name}</h2><MessageForm target="school" /></section>
      <section className="card divide-y divide-slate-100"><h2 className="p-5 font-semibold">Recent recipients</h2>{error && <p role="alert" className="p-5">{error.message}</p>}{(data || []).map(m => <article key={m.id} className="p-5"><div className="flex justify-between gap-3"><h3 className="font-medium">{m.payload.title}</h3><span className={`text-xs ${m.acknowledged_at ? "text-emerald-700" : "text-slate-500"}`}>{m.acknowledged_at ? "Acknowledged" : m.status === "succeeded" ? "Delivered to agent" : m.status}</span></div><p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-slate-600">{m.payload.body}</p><p className="mt-3 text-xs text-slate-400">{(Array.isArray(m.devices) ? m.devices[0]?.student_name : (m.devices as {student_name?: string} | null)?.student_name) || "Student"} · {dateTime(m.created_at)}{m.acknowledged_at ? ` · Acknowledged ${dateTime(m.acknowledged_at)}` : ""}</p></article>)}{!data?.length && !error && <p className="p-6 text-slate-500">Your first school message starts a lasting conversation.</p>}</section>
    </div></>;
}
