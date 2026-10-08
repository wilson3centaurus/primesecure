import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Battery, OnlineDot, StatusBadge } from "@/components/badges";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { canManage, requireStaff } from "@/lib/auth";
import { dateTime, deviceLabel } from "@/lib/format";
import { getPolicy } from "@/lib/policy";
import { createClient } from "@/lib/supabase/server";
import type { Device } from "@/lib/types";
import { DeleteDeviceForm, IssueTokenForm, StudentForm } from "./forms";

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
  const ownPolicy = await getPolicy(d.school_id, d.id);
  const tokenValid = d.enroll_token && d.enroll_token_expires_at && new Date(d.enroll_token_expires_at) > new Date();

  return (
    <>
      <RealtimeRefresh table="devices" filter={`id=eq.${d.id}`} />
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
        </section>

        <div className="space-y-6">
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
