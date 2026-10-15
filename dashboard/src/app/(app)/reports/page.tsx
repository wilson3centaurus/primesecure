import Link from "next/link";
import { redirect } from "next/navigation";
import { Monitor, Wifi, Clock3, AppWindow } from "lucide-react";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dateTime } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { ReportExport } from "@/components/report-export";
import { duration, type UsageReport } from "./data";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const [staff, school, filters] = await Promise.all([requireStaff(), getCurrentSchool(), searchParams]);
  if (!school) return <p>Select a school first.</p>;
  if (!canManage(staff, school.id)) redirect("/overview");
  const db = await createClient();
  const days = filters.days === "30" ? 30 : 7;
  const today = new Date();
  const since = new Date(today.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const until = today.toISOString().slice(0, 10);
  const { data, error } = await db.rpc("staff_usage_report", { p_school: school.id, p_days: days });
  const report = data as UsageReport | null;
  const students = Array.isArray(report?.devices) ? report.devices : [];
  const apps = Array.isArray(report?.apps) ? report.apps : [];
  const totals = report?.totals || { screen_ms: 0, online_ms: 0, uptime_ms: 0, reporting_devices: 0, app_package_count: 0 };
  const cards = [{ label: "Observed screen time", value: duration(totals.screen_ms), icon: Monitor }, { label: "Connected time", value: duration(totals.online_ms), icon: Wifi }, { label: "Observed uptime", value: duration(totals.uptime_ms), icon: Clock3 }, { label: "Apps used", value: totals.app_package_count, icon: AppWindow }];
  return <>
    <PageHeader title="Usage reports" description="School device activity and app rankings, with reporting coverage shown alongside each student." />
    <form className="card mb-5 flex flex-wrap items-end gap-3 p-4">
      <label className="label">Period<select name="days" className="input mt-1" defaultValue={days}><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>

      <button className="btn-primary">View report</button>
    </form>
    <p className="mb-5 text-xs text-slate-500">{since} to {until} · UTC reporting days · {totals.reporting_devices} of {students.length} devices reported in this period.</p>
    {error && <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><strong>Reports could not load.</strong><p className="mt-1">{error.message}</p><p className="mt-1">The school reporting migration and agent 0.7.0 or newer are required.</p></div>}
    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(card => <section className="stat-card" key={card.label}><card.icon size={19} className="mb-4 text-brand-500" /><p className="text-xs text-slate-500">{card.label}</p><p className="mt-2 text-2xl font-semibold">{card.value}</p></section>)}</div>
    <section className="card mb-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><h2 className="font-semibold">Students & device activity</h2><p className="mt-1 text-xs text-slate-400">Ranked by observed screen time.</p></div><ReportExport filename={`student-usage-${since}-${until}`} columns={["Student", "Student number", "Prime ID", "Form", "Class", "Screen minutes", "Connected minutes", "Uptime minutes", "Reported days", "Days with Usage Access", "Last report", "Coverage"]} rows={students.map(student => [student.student_name, student.student_id || null, student.prime_id, student.form_level, student.class_name, Math.floor(student.screen_ms / 60000), Math.floor(student.online_ms / 60000), Math.floor(student.uptime_ms / 60000), student.reported_days, student.usage_access_days ?? (student.usage_access ? "Access reported" : "No access reported"), student.last_reported_at, (student.coverage || []).join(" | ")])} /></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["Student / Prime ID", "Screen", "Connected", "Uptime", "Coverage"].map(label => <th className="px-5 py-3 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{students.map(student => <tr className="border-t border-slate-100" key={student.id}><td className="px-5 py-4"><Link href={`/devices/${student.id}`} className="font-medium text-brand-700">{student.student_name || "Unnamed student"}</Link><div className="mt-1 font-mono text-xs text-slate-400">{student.prime_id || "Prime ID not reported"}</div><div className="mt-1 text-xs text-slate-400">{[student.form_level, student.class_name].filter(Boolean).join(" · ")}</div></td><td className="px-5 py-4 tabular-nums">{duration(student.screen_ms)}</td><td className="px-5 py-4 tabular-nums">{duration(student.online_ms)}</td><td className="px-5 py-4 tabular-nums">{duration(student.uptime_ms)}</td><td className="max-w-sm px-5 py-4 text-xs text-slate-500">{student.reported_days ? <><span>{student.reported_days}/{days} days · app access {student.usage_access_days ?? (student.usage_access ? "reported" : "none")}/{student.reported_days} days</span><div className="mt-1 text-slate-400">{dateTime(student.last_reported_at)}</div><details className="mt-2"><summary className="cursor-pointer text-brand-700">Reporting limits</summary>{(student.coverage || ["See the report limitations below; observed totals can contain gaps."]).map(text => <p className="mt-2 leading-5" key={text}>{text}</p>)}</details></> : "No report received"}</td></tr>)}</tbody></table></div>
      {!students.length && <p className="p-6 text-sm text-slate-500">No students in this school yet.</p>}
    </section>
    <section className="card mb-6 overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><h2 className="font-semibold">Most-used apps (top 100)</h2><p className="mt-1 text-xs text-slate-400">Foreground time reported by Android Usage Access. The table and CSV contain the top 100 packages.</p></div><ReportExport filename={`app-usage-${since}-${until}`} columns={["App", "Package", "Foreground minutes", "Devices"]} rows={apps.map(app => [app.label, app.package, Math.floor(app.foreground_ms / 60000), app.device_count])} /></div>{apps.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-5 py-3 font-medium">App</th><th className="px-5 py-3 font-medium">Foreground time</th><th className="px-5 py-3 font-medium">Devices</th></tr></thead><tbody>{apps.map(app => <tr className="border-t border-slate-100" key={app.package}><td className="px-5 py-3"><div className="font-medium">{app.label}</div><div className="mt-1 font-mono text-xs text-slate-400">{app.package}</div></td><td className="px-5 py-3">{duration(app.foreground_ms)}</td><td className="px-5 py-3">{app.device_count}</td></tr>)}</tbody></table></div> : <p className="p-6 text-sm text-slate-500">No app activity reported in this period. Enable usage reports in <Link href="/settings" className="text-brand-700 underline">Settings</Link> and grant Android Usage Access on the device.</p>}</section>
    <aside className="rounded-xl border border-slate-200 bg-white/70 p-5 text-xs leading-6 text-slate-500"><strong className="text-slate-700">How to read these reports</strong><p>These are observed totals while the management service runs, with gaps and shutdown periods excluded. Screen and connection estimates have up to 30-second resolution. “Connected” means internet connectivity was detected; it does not prove the student was browsing. App totals need Android Usage Access and can miss activity spanning midnight or exceed screen time when Android reports overlapping activities.</p><p className="mt-2">Reports contain app names and durations, not screen recordings, keystrokes, private messages or document contents. Days without reports mean unknown activity, not zero use. UTC day boundaries can differ from the school’s calendar day. <Link href="/cases" className="text-brand-700 underline">Issues & cases</Link> shows unapproved-app activity that needs staff review.</p></aside>
  </>;
}
