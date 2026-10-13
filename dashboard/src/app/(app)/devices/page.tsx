import type { Metadata } from "next";
import Link from "next/link";
import { Battery, OnlineDot, StatusBadge } from "@/components/badges";
import { MessageForm } from "@/components/message-form";
import { PageHeader } from "@/components/page-header";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { deviceLabel, isOnline } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Device, DeviceStatus } from "@/lib/types";
import { AddDevicesForm } from "./add-devices-form";

export const metadata: Metadata = { title: "Devices" };

const FILTERS = ["all", "online", "offline", "pending", "suspended", "locked", "retired"] as const;
type Filter = (typeof FILTERS)[number];

export default async function DevicesPage({ searchParams }: PageProps<"/devices">) {
  const staff = await requireStaff();
  const school = await getCurrentSchool();
  if (!school) return <PageHeader title="Devices" description="No school yet. A RoboKorda admin needs to add one." />;

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const filter: Filter = FILTERS.includes(sp.filter as Filter) ? (sp.filter as Filter) : "all";

  const supabase = await createClient();
  const { data } = await supabase
    .from("devices")
    .select("*")
    .eq("school_id", school.id)
    .order("student_name", { ascending: true, nullsFirst: false })
    .limit(2000);
  const all = (data ?? []) as Device[];
  const levels=[...new Set(all.map(d=>d.form_level).filter(Boolean))].sort(), classes=[...new Set(all.map(d=>d.class_name).filter(Boolean))].sort(), genders=[...new Set(all.map(d=>d.gender).filter(Boolean))].sort();
  const selectedForm=String(sp.form_level||''),selectedClass=String(sp.class_name||''),selectedGender=String(sp.gender||'');

  const { counts, devices } = filterDevices(all, filter, q);
  const grouped=devices.filter(d=>(!selectedForm||d.form_level===selectedForm)&&(!selectedClass||d.class_name===selectedClass)&&(!selectedGender||d.gender===selectedGender));

  return (
    <>
      <RealtimeRefresh table="devices" filter={`school_id=eq.${school.id}`} />
      <PageHeader title="Devices" description={`Primebooks enrolled at ${school.name}.`}>
        <div className="flex flex-wrap gap-2">
          <MessageForm target="school" collapsible label="Message all devices" />
          {canManage(staff, school.id) && <AddDevicesForm />}
        </div>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link key={f} href={{ pathname: "/devices", query: { ...(q && { q }), ...(f !== "all" && { filter: f }) } }}
            className={`rounded-full px-3 py-1 text-sm capitalize ring-1 ring-inset ${
              filter === f ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
            }`}>
            {f === "pending" ? "Not enrolled" : f} <span className="opacity-60">{counts[f]}</span>
          </Link>
        ))}
        <form className="ml-auto">
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <input name="q" defaultValue={q} placeholder="Search student, serial, model…" aria-label="Search devices" className="input w-64" />
        </form>
      </div>

      <form className="card mb-5 flex flex-wrap gap-3 p-4"><input type="hidden" name="q" value={q}/><input type="hidden" name="filter" value={filter}/>{[['form_level','All forms',levels,selectedForm],['class_name','All classes',classes,selectedClass],['gender','All genders',genders,selectedGender]].map(([name,label,options,value])=><select key={String(name)} name={String(name)} defaultValue={String(value)} className="input w-auto" aria-label={String(label)}><option value="">{String(label)}</option>{(options as string[]).map(v=><option key={v}>{v}</option>)}</select>)}<button className="btn-primary">Apply filters</button><span className="self-center text-xs text-slate-400">{grouped.length} students</span></form>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-2">Student</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Last seen</th>
              <th className="px-4 py-2">Battery</th>
              <th className="px-4 py-2">Model</th>
              <th className="px-4 py-2">Agent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {grouped.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No devices match.</td></tr>
            )}
            {grouped.map((d) => (
              <tr key={d.id} className="hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link href={`/devices/${d.id}`} className="font-medium text-brand-700 hover:underline">{deviceLabel(d)}</Link>
                  {d.student_id && <div className="text-xs text-slate-500">{d.student_id}</div>}
                  <div className="mt-1 text-xs text-slate-400">{[d.form_level,d.class_name,d.gender].filter(Boolean).join(' · ')}</div>
                </td>
                <td className="px-4 py-2"><StatusBadge status={d.status} /></td>
                <td className="px-4 py-2">{d.status === "pending" ? <span className="text-slate-400">—</span> : <OnlineDot device={d} />}</td>
                <td className="px-4 py-2"><Battery level={d.battery_level} charging={d.battery_charging} /></td>
                <td className="px-4 py-2 text-slate-600">{d.model ?? "—"}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{d.agent_version ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Bucket counts for the filter chips, plus the rows matching filter + search.
function filterDevices(all: Device[], filter: Filter, q: string) {
  const now = Date.now();
  const online = (d: Device) => d.status !== "pending" && isOnline(d, now);
  const offline = (d: Device) => d.status !== "pending" && d.status !== "retired" && !isOnline(d, now);

  const counts: Record<Filter, number> = {
    all: all.length,
    online: all.filter(online).length,
    offline: all.filter(offline).length,
    pending: 0, suspended: 0, locked: 0, retired: 0,
  };
  for (const d of all) if (d.status !== "active") counts[d.status as Exclude<DeviceStatus, "active">]++;

  const needle = q.toLowerCase();
  const devices = all.filter((d) => {
    if (filter === "online" && !online(d)) return false;
    if (filter === "offline" && !offline(d)) return false;
    if (filter !== "all" && filter !== "online" && filter !== "offline" && d.status !== filter) return false;
    if (!needle) return true;
    return [d.student_name, d.student_id, d.serial, d.model, d.android_id].some((v) => v?.toLowerCase().includes(needle));
  });
  return { counts, devices };
}
