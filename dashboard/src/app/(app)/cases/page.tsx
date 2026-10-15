import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, ChevronLeft, ChevronRight } from "lucide-react";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dateTime } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { CaseCreate, CaseUpdate } from "@/components/case-update";
import { ReportExport } from "@/components/report-export";
import { duration } from "../reports/data";

type DeviceOption = { id: string; student_name: string | null; student_id: string | null; prime_id: string | null };
type DeviceCase = { id: string; device_id: string; school_id: string; category: "unapproved_app" | "manual" | "lost_device"; title: string; package: string; day: string; state: "open" | "observing" | "resolved"; staff_note: string; evidence: { foreground_ms?: number; source?: string }; created_at: string; updated_at: string };
const categories = { unapproved_app: "Unapproved app activity", manual: "Staff case", lost_device: "Lost device" };
const states = { open: "Open", observing: "Observing", resolved: "Resolved" };

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ state?: string; device?: string; page?: string }> }) {
  const [staff, school, filters] = await Promise.all([requireStaff(), getCurrentSchool(), searchParams]);
  if (!school) return <p>Select a school first.</p>;
  if (!canManage(staff, school.id)) redirect("/overview");
  const db = await createClient();
  const state = ["open", "observing", "resolved", "all"].includes(filters.state || "") ? filters.state! : "open";
  const page = Math.max(1, Math.min(10_000, Number.parseInt(filters.page || "1", 10) || 1));
  // Fetch all students for the dropdown without relying on the API's default row limit.
  const devices: DeviceOption[] = [];
  let devicesError: string | null = null;
  for (let offset = 0; offset < 10_000; offset += 1000) {
    const result = await db.from("devices").select("id,student_name,student_id,prime_id").eq("school_id", school.id).order("id").range(offset, offset + 999);
    if (result.error) { devicesError = result.error.message; break; }
    devices.push(...(result.data || []));
    if ((result.data?.length || 0) < 1000) break;
    if (offset === 9000) devicesError = "Only the first 10,000 students are available in this selector.";
  }
  devices.sort((a, b) => (a.student_name || "").localeCompare(b.student_name || ""));
  const deviceMap = new Map(devices.map(device => [device.id, device]));
  const selectedDevice = filters.device && deviceMap.has(filters.device) ? filters.device : "";
  let query = db.from("device_cases").select("*", { count: "exact" }).eq("school_id", school.id);
  if (state !== "all") query = query.eq("state", state);
  if (selectedDevice) query = query.eq("device_id", selectedDevice);
  const { data, error, count } = await query.order("updated_at", { ascending: false }).order("id").range((page - 1) * 50, page * 50 - 1);
  const cases = (data || []) as DeviceCase[];
  const pages = Math.max(1, Math.ceil((count || 0) / 50));
  const pageLink = (number: number) => "/cases?" + new URLSearchParams({ state, ...(selectedDevice ? { device: selectedDevice } : {}), page: String(number) }).toString();
  return <>
    <PageHeader title="Issues & cases" description="Review app activity that needs attention, record staff findings and track follow-up." />
    <div className="mb-5 rounded-xl border border-slate-200 bg-white/70 p-4 text-xs leading-6 text-slate-500">Automatic cases flag at least 30 seconds of reported foreground use of an unapproved, non-system app. They show app names and aggregate time, not private messages or screen content. A case is a signal to review, not proof of misconduct. <Link href="/reports" className="text-brand-700 underline">View usage reports</Link>.</div>
    <form className="card mb-5 flex flex-wrap items-end gap-3 p-4">
      <label className="label">Review state<select name="state" defaultValue={state} className="input mt-1"><option value="open">Open</option><option value="observing">Observing</option><option value="resolved">Resolved</option><option value="all">All states</option></select></label>
      <label className="label min-w-56 flex-1">Student<select name="device" defaultValue={selectedDevice} className="input mt-1"><option value="">All students</option>{devices.map(device => <option value={device.id} key={device.id}>{device.student_name || "Unnamed student"} · {device.prime_id || device.student_id || "Prime ID pending"}</option>)}</select></label>
      <button className="btn-primary">View cases</button>
    </form>
    {(error || devicesError) && <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{error?.message || devicesError} The school reporting migration is required.</div>}
    <details className="card mb-5 p-5"><summary className="cursor-pointer text-sm font-semibold text-brand-700">Open a staff case</summary><CaseCreate devices={devices.map(device => ({ id: device.id, label: `${device.student_name || "Unnamed student"} · ${device.prime_id || device.student_id || "Prime ID pending"}` }))} /></details>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-500">{count || 0} cases · page {page} of {pages}</p><ReportExport filename={`school-cases-${state}-page-${page}`} columns={["Student", "Prime ID", "Category", "Title", "Package", "Day", "State", "Foreground minutes", "Staff notes", "Updated"]} rows={cases.map(item => [deviceMap.get(item.device_id)?.student_name || null, deviceMap.get(item.device_id)?.prime_id || null, categories[item.category], item.title, item.category === "unapproved_app" ? item.package : null, item.day, states[item.state], item.evidence.foreground_ms != null ? Math.floor(item.evidence.foreground_ms / 60000) : null, item.staff_note, item.updated_at])} /></div>
    <div className="space-y-4">{cases.map(item => {
      const device = deviceMap.get(item.device_id);
      return <article className="card p-5" key={item.id}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="mb-2 text-xs font-medium text-slate-400">{categories[item.category]} · {item.day}</div><h2 className="font-semibold text-slate-800">{item.title}</h2><Link href={`/devices/${item.device_id}`} className="mt-2 inline-block text-sm text-brand-700">{device?.student_name || "Student"}</Link><span className="ml-3 font-mono text-xs text-slate-400">{device?.prime_id || "Prime ID not reported"}</span></div><span className={`rounded-full px-3 py-1 text-xs font-medium ${item.state === "resolved" ? "bg-emerald-50 text-emerald-700" : item.state === "observing" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>{states[item.state]}</span></div>
        {item.category === "unapproved_app" && item.package && <p className="mt-3 break-all font-mono text-xs text-slate-400">{item.package}</p>}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">{item.evidence.foreground_ms != null && <span>Reported foreground time: <strong>{duration(item.evidence.foreground_ms)}</strong></span>}{item.evidence.source && <span>Source: {String(item.evidence.source).slice(0, 200)}</span>}<span>Updated {dateTime(item.updated_at)}</span></div>
        <details className="mt-4 border-t border-slate-100 pt-4"><summary className="cursor-pointer text-xs font-semibold text-brand-700">Staff notes & review</summary><p className="mt-3 text-xs leading-5 text-slate-500">Observing records a staff review in progress. It does not change app rules or enable camera, microphone or screen capture.</p><CaseUpdate id={item.id} state={item.state} note={item.staff_note} /></details>
      </article>;
    })}</div>
    {!cases.length && <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center"><ClipboardList size={30} className="text-slate-300" /><h2 className="font-medium">No cases in this view</h2><p className="max-w-md text-sm text-slate-500">Change the filters or open a staff case. Automatic app cases require usage reporting and Android Usage Access on the Primebook.</p></div>}
    <nav aria-label="Case pages" className="mt-6 flex items-center justify-between">{page > 1 ? <Link className="btn-secondary inline-flex items-center gap-2" href={pageLink(page - 1)}><ChevronLeft size={16} />Previous</Link> : <span />}{page < pages && <Link className="btn-secondary inline-flex items-center gap-2" href={pageLink(page + 1)}>Next<ChevronRight size={16} /></Link>}</nav>
  </>;
}
