import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { ReviewRequest } from "@/components/hub-forms";
import { dateTime } from "@/lib/format";
export async function AppRequests() {
  const staff = await requireStaff(); const school = await getCurrentSchool();
  if (!school) return <PageHeader title="App requests" description="Select a school." />;
  const supabase = await createClient();
  const { data, error } = await supabase.from("hub_requests").select("*,devices(student_name)").eq("school_id", school.id).order("created_at", { ascending: false }).limit(200);
  return <><PageHeader title="Student app requests" description="Review what students need, then publish approved APKs to their library." />
    {error && <p role="alert">{error.message}</p>}<div className="space-y-4">{(data || []).map(r => <article key={r.id} className="card flex flex-wrap justify-between gap-4 p-5"><div><h2 className="font-semibold">{r.name}</h2><p className="text-sm text-slate-500">{(Array.isArray(r.devices) ? r.devices[0]?.student_name : (r.devices as {student_name?: string} | null)?.student_name) || "Student"} · {dateTime(r.created_at)} · {r.status}</p><p className="mt-2">{r.reason}</p></div>{canManage(staff, school.id) && <ReviewRequest id={r.id} status={r.status} />}</article>)}</div>
    {!data?.length && !error && <p className="card p-8 text-slate-500">No app requests yet.</p>}</>;
}
