import type { Metadata } from "next";
import Link from "next/link";
import { Battery, OnlineDot, StatusBadge } from "@/components/badges";
import { MessageForm } from "@/components/message-form";
import { PageHeader } from "@/components/page-header";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { StudentAvatar } from "@/components/student-avatar";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { deviceLabel, isOnline } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Device, DeviceStatus } from "@/lib/types";
import { AddDevicesForm } from "./add-devices-form";

export const metadata: Metadata = { title: "Students & devices" };
const FILTERS = ["all", "online", "offline", "pending", "suspended", "locked", "retired"] as const;
type Filter = (typeof FILTERS)[number];
type DeviceRow = Pick<Device, "id" | "student_name" | "student_id" | "form_level" | "class_name" | "gender" | "status" | "last_seen_at" | "battery_level" | "battery_charging" | "model" | "serial" | "android_id" | "agent_version"> & { prime_id: string | null };
const PAGE_SIZE = 50;
const LIST_FIELDS = "id,student_name,student_id,prime_id,form_level,class_name,gender,status,last_seen_at,battery_level,battery_charging,model,serial,android_id,agent_version";

export default async function DevicesPage({ searchParams }: PageProps<"/devices">) {
  const staff = await requireStaff();
  const school = await getCurrentSchool();
  if (!school) return <PageHeader title="Students & devices" description="No school yet. A RoboKorda admin needs to add one." />;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const filter: Filter = FILTERS.includes(sp.filter as Filter) ? (sp.filter as Filter) : "all";
  const selectedForm = typeof sp.form_level === "string" ? sp.form_level : "";
  const selectedClass = typeof sp.class_name === "string" ? sp.class_name : "";
  const selectedGender = typeof sp.gender === "string" ? sp.gender : "";
  const manager = canManage(staff, school.id);
  const supabase = await createClient();
  // Count/filter lightweight metadata only; photos are fetched for this page below.
  const [first, { data: groups }] = await Promise.all([
    supabase.from("devices").select(LIST_FIELDS).eq("school_id", school.id)
      .order("student_name", { ascending: true, nullsFirst: false }).order("id").range(0,999),
    supabase.from("school_classes").select("id,form_level,class_name").eq("school_id", school.id).order("form_level").order("class_name"),
  ]);
  const rest=first.data?.length===1000 ? await supabase.from("devices").select(LIST_FIELDS).eq("school_id",school.id)
    .order("student_name",{ascending:true,nullsFirst:false}).order("id").range(1000,1999) : {data:[],error:null};
  // Two bounded ranges also respect PostgREST's usual 1,000-row response limit.
  const all = [...(first.data ?? []), ...(rest.data ?? [])] as DeviceRow[];
  const error=first.error || rest.error;
  const levels = [...new Set([...all.map((d) => d.form_level), ...(groups ?? []).map((g) => g.form_level)].filter(Boolean))].sort();
  const classes = [...new Set([...all.map((d) => d.class_name), ...(groups ?? []).map((g) => g.class_name)].filter(Boolean))].sort();
  const genders = [...new Set(all.map((d) => d.gender).filter(Boolean))].sort();
  const grouped = all.filter((d) => (!selectedForm || d.form_level === selectedForm) && (!selectedClass || d.class_name === selectedClass) && (!selectedGender || d.gender === selectedGender));
  const { counts, devices } = filterDevices(grouped, filter, q);
  const pages = Math.max(1, Math.ceil(devices.length / PAGE_SIZE));
  const requestedPage = typeof sp.page === "string" && /^\d{1,6}$/.test(sp.page) ? Number(sp.page) : 1;
  const page = Math.min(pages, Math.max(1, requestedPage));
  const visible = devices.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const { data: portraits } = manager && visible.length > 0
    ? await supabase.from("student_records").select("device_id,profile_photo").in("device_id", visible.map((d) => d.id))
    : { data: [] };
  const photos = new Map((portraits ?? []).map((record) => [record.device_id, record.profile_photo as string | null]));
  const query = { ...(q && { q }), ...(filter !== "all" && { filter }), ...(selectedForm && { form_level: selectedForm }), ...(selectedClass && { class_name: selectedClass }), ...(selectedGender && { gender: selectedGender }) };
  const filterFields = [
    { name: "form_level", label: "All forms", options: levels, value: selectedForm },
    { name: "class_name", label: "All classes", options: classes, value: selectedClass },
    { name: "gender", label: "All genders", options: genders, value: selectedGender },
  ];

  return <>
    <RealtimeRefresh table="devices" filter={`school_id=eq.${school.id}`} />
    <PageHeader title="Students & devices" description={`Student records and managed Primebooks at ${school.name}.`}>
      <div className="flex flex-wrap gap-2"><MessageForm target="school" collapsible label="Message all devices" />{manager && <AddDevicesForm groups={groups ?? []} />}</div>
    </PageHeader>
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {FILTERS.map((value) => <Link key={value} href={{ pathname: "/devices", query: { ...query, filter: value } }} className={`rounded-full px-3 py-1.5 text-sm capitalize ring-1 ring-inset ${filter === value ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}>
        {value === "pending" ? "Not enrolled" : value} <span className="opacity-60">{counts[value]}</span>
      </Link>)}
      <form className="ml-auto flex gap-2">
        {Object.entries(query).filter(([name]) => name !== "q").map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <input name="q" defaultValue={q} placeholder="Name, Prime ID, student number…" aria-label="Search students and devices" className="input w-64" />
        <button className="btn-secondary">Search</button>
      </form>
    </div>
    <form className="card mb-5 flex flex-wrap items-center gap-3 p-4">
      <input type="hidden" name="q" value={q} /><input type="hidden" name="filter" value={filter} />
      {filterFields.map(({ name, label, options, value }) => <select key={name} name={name} defaultValue={value} className="input w-auto" aria-label={label}><option value="">{label}</option>{options.map((option) => <option key={option}>{option}</option>)}</select>)}
      <button className="btn-primary">Apply filters</button><span className="text-xs text-slate-500">{devices.length} matching students</span>
    </form>
    {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">Student records could not be loaded. Refresh and try again.</p>}
    {all.length === 2000 && <p className="mb-4 text-xs text-slate-500">The directory currently covers the first 2,000 records in this school.</p>}
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[1040px] text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase"><tr>
          <th className="w-20 px-4 py-3">Photo</th><th className="px-4 py-3">Student / Prime ID</th><th className="px-4 py-3">Class</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Last seen</th><th className="px-4 py-3">Battery</th><th className="px-4 py-3">Model</th><th className="px-4 py-3">Agent</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {visible.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">{error ? "Records unavailable." : "No students match these filters."}</td></tr>}
          {visible.map((d) => <tr key={d.id} className="hover:bg-slate-50">
            <td className="px-4 py-3"><StudentAvatar src={photos.get(d.id)} name={deviceLabel(d)} /></td>
            <td className="px-4 py-3"><Link href={`/devices/${d.id}`} className="font-semibold text-brand-700 hover:underline">{deviceLabel(d)}</Link><div className="mt-1 font-mono text-xs text-slate-600">{d.prime_id ? `Prime ID ${d.prime_id}` : "Prime ID not reported"}</div>{d.student_id && <div className="mt-1 text-xs text-slate-400">Student no. {d.student_id}</div>}</td>
            <td className="px-4 py-3 text-slate-600"><div>{[d.form_level, d.class_name].filter(Boolean).join(" · ") || "Not assigned"}</div>{d.gender && <div className="mt-1 text-xs text-slate-400">{d.gender}</div>}</td>
            <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
            <td className="px-4 py-3">{d.status === "pending" ? <span className="text-slate-400">—</span> : <OnlineDot device={d} />}</td>
            <td className="px-4 py-3"><Battery level={d.battery_level} charging={d.battery_charging} /></td>
            <td className="px-4 py-3 text-slate-600">{d.model ?? "—"}</td>
            <td className="px-4 py-3 font-mono text-xs text-slate-500">{d.agent_version ?? "—"}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <nav aria-label="Student directory pages" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
      <span>{devices.length ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, devices.length)} of ${devices.length}` : "0 students"} · 50 per page</span>
      <div className="flex items-center gap-3">{page > 1 && <Link className="btn-secondary" href={{ pathname: "/devices", query: { ...query, page: page - 1 } }}>Previous</Link>}<span>Page {page} of {pages}</span>{page < pages && <Link className="btn-secondary" href={{ pathname: "/devices", query: { ...query, page: page + 1 } }}>Next</Link>}</div>
    </nav>
  </>;
}

function filterDevices(all: DeviceRow[], filter: Filter, q: string) {
  const now = Date.now();
  const online = (d: DeviceRow) => d.status !== "pending" && d.status !== "retired" && isOnline(d, now);
  const offline = (d: DeviceRow) => d.status !== "pending" && d.status !== "retired" && !isOnline(d, now);
  const counts: Record<Filter, number> = { all: all.length, online: all.filter(online).length, offline: all.filter(offline).length, pending: 0, suspended: 0, locked: 0, retired: 0 };
  for (const device of all) if (device.status !== "active") counts[device.status as Exclude<DeviceStatus, "active">]++;
  const needle = q.toLowerCase();
  const devices = all.filter((d) => {
    if (filter === "online" && !online(d)) return false;
    if (filter === "offline" && !offline(d)) return false;
    if (!["all", "online", "offline"].includes(filter) && d.status !== filter) return false;
    return !needle || [d.student_name, d.student_id, d.prime_id, d.serial, d.model, d.android_id].some((value) => value?.toLowerCase().includes(needle));
  });
  return { counts, devices };
}
