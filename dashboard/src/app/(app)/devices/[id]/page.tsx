import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InstallOnDeviceForm, RemoveAppButton } from "@/components/app-forms";
import { Battery, OnlineDot, StatusBadge } from "@/components/badges";
import { CommandHistory } from "@/components/command-history";
import { LocationPanel } from "@/components/location-panel";
import { MessageForm } from "@/components/message-form";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { canManage, requireStaff } from "@/lib/auth";
import { dateTime, deviceLabel } from "@/lib/format";
import { getPolicy } from "@/lib/policy";
import { createClient } from "@/lib/supabase/server";
import type { App, Command, Device, DeviceLocation } from "@/lib/types";
import { DeleteDeviceForm, IssueTokenForm, StudentForm } from "./forms";
import { StateControls } from "./state-controls";

export const metadata: Metadata = { title: "Device" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium break-all">{children ?? "—"}</dd>
    </div>
  );
}

export default async function DevicePage({ params }: PageProps<"/devices/[id]">) {
  const { id } = await params;
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase.from("devices").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const d = data as Device;
  const manager = canManage(staff, d.school_id);
  const [ownPolicy, commands, { data: library }, { data: locationRows }] = await Promise.all([
    getPolicy(d.school_id, d.id),
    recentCommands(d.id),
    supabase.from("apps").select("*").eq("school_id", d.school_id).order("name"),
    supabase.from("locations").select("*").eq("device_id", d.id).order("created_at", { ascending: false }).limit(10),
  ]);
  const locations = (locationRows ?? []) as DeviceLocation[];
  const installed = [...(d.installed_apps ?? [])].sort((a, b) => Number(a.system) - Number(b.system) || a.label.localeCompare(b.label));
  const enrolled = d.status !== "pending" && d.status !== "retired";
  const tokenValid = d.enroll_token && d.enroll_token_expires_at && new Date(d.enroll_token_expires_at) > new Date();

  return (
    <>
      <RealtimeRefresh table="devices" filter={`id=eq.${d.id}`} />
      <RealtimeRefresh table="commands" filter={`device_id=eq.${d.id}`} />
      <Link href="/devices" className="text-sm text-slate-500 hover:underline">← Devices</Link>
      <div className="mt-2 mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{deviceLabel(d)}</h1>
        <StatusBadge status={d.status} />
        {d.status !== "pending" && <OnlineDot device={d} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">Device</h2>
          <dl className="divide-y divide-slate-100">
            <Row label="Model">{[d.manufacturer, d.model].filter(Boolean).join(" ") || null}</Row>
            <Row label="Serial">{d.serial}</Row>
            <Row label="Android ID">{d.android_id}</Row>
            <Row label="OS">{d.os_version}</Row>
            <Row label="Agent">{d.agent_version}</Row>
            <Row label="Battery"><Battery level={d.battery_level} charging={d.battery_charging} /></Row>
            <Row label="Last IP">{d.last_ip}</Row>
            <Row label="Last check-in">{dateTime(d.last_seen_at)}</Row>
            <Row label="Enrolled">{dateTime(d.enrolled_at)}</Row>
          </dl>

          <h2 className="mt-6 mb-2 font-semibold">Apps</h2>
          {manager && enrolled && <div className="mb-3"><InstallOnDeviceForm deviceId={d.id} apps={(library ?? []) as App[]} /></div>}
          {installed.length === 0 ? (
            <p className="text-sm text-slate-500">{enrolled ? "Reported at the next check-in." : "—"}</p>
          ) : (
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto text-sm">
              {installed.map((a) => (
                <li key={a.package} className="flex items-center justify-between gap-3 py-1.5">
                  <div className="min-w-0">
                    <div className="truncate">{a.label}{a.system && <span className="ml-2 text-xs text-slate-400">system</span>}</div>
                    <div className="truncate font-mono text-xs text-slate-500">{a.package}{a.version && ` · ${a.version}`}</div>
                  </div>
                  {manager && enrolled && !a.system && a.package !== "com.robokorda.primesecure" && (
                    <RemoveAppButton deviceId={d.id} pkg={a.package} label={a.label} />
                  )}
                </li>
              ))}
            </ul>
          )}

          <h2 className="mt-6 mb-2 font-semibold">Recent commands</h2>
          <CommandHistory commands={commands} canCancel={manager} />
        </section>

        <div className="space-y-6">
          {d.status !== "pending" && d.status !== "retired" && (
            <section className="card p-4">
              <h2 className="mb-3 font-semibold">Message the student</h2>
              <MessageForm target={d.id} />
            </section>
          )}

          {d.status !== "pending" && (
            <section className="card p-4">
              <h2 className="mb-3 font-semibold">Location</h2>
              <LocationPanel deviceId={d.id} locations={locations} canLocate={manager && enrolled}
                times={locations.map((l) => dateTime(l.created_at))} />
            </section>
          )}

          {manager && (
            <section className="card p-4">
              <h2 className="mb-3 font-semibold">Lock, suspend, retire</h2>
              <StateControls id={d.id} status={d.status} message={d.status_message} />
              {d.status_changed_at && <p className="mt-3 text-xs text-slate-400">State last changed {dateTime(d.status_changed_at)}</p>}
            </section>
          )}

          <section className="card p-4">
            <h2 className="mb-3 font-semibold">Enrollment</h2>
            {tokenValid ? (
              <div className="mb-3">
                <div className="text-sm text-slate-500">Enroll token (single use, expires {dateTime(d.enroll_token_expires_at)})</div>
                <div className="font-mono text-3xl font-semibold tracking-widest">{d.enroll_token}</div>
                <p className="mt-2 text-xs text-slate-500">
                  On the Primebook: <code className="rounded bg-slate-100 px-1">adb shell am start -n com.robokorda.primesecure/.MainActivity --es token {d.enroll_token}</code>
                </p>
              </div>
            ) : (
              <p className="mb-3 text-sm text-slate-600">
                {d.auth_user_id ? "Enrolled. Issue a new token only to re-enroll after a reset or reinstall." : "The enroll token has expired."}
              </p>
            )}
            {manager && <IssueTokenForm id={d.id} label={tokenValid ? "Issue a different token" : "Issue enroll token"} />}
          </section>

          <section className="card p-4">
            <h2 className="mb-1 font-semibold">Policy</h2>
            <p className="mb-3 text-sm text-slate-600">
              {ownPolicy ? "Has its own policy (replaces the school policy)." : "Follows the school policy."}
            </p>
            <Link href={`/devices/${d.id}/policy`} className="btn-secondary">
              {ownPolicy ? "Edit device policy" : manager ? "Give this device its own policy" : "View"}
            </Link>
          </section>

          {manager && (
            <section className="card p-4">
              <h2 className="mb-3 font-semibold">Student</h2>
              <StudentForm id={d.id} name={d.student_name} studentId={d.student_id} />
            </section>
          )}

          {manager && (
            <section className="card border-red-200 p-4">
              <h2 className="mb-3 font-semibold text-red-700">Danger zone</h2>
              <DeleteDeviceForm id={d.id} />
            </section>
          )}
        </div>
      </div>
    </>
  );
}

async function recentCommands(deviceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("commands")
    .select("*")
    .eq("device_id", deviceId)
    .order("created_at", { ascending: false })
    .limit(25);
  const commands = (data ?? []) as Command[];

  const senderIds = [...new Set(commands.map((c) => c.created_by).filter((v): v is string => !!v))];
  const { data: people } = senderIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", senderIds)
    : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name as string | null]));

  return commands.map((c) => ({
    ...c,
    sender: (c.created_by && names.get(c.created_by)) || null,
    when: dateTime(c.created_at),
  }));
}
