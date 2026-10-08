import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireStaff } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PublishRelease, ReleaseActions } from "./forms";

export const metadata: Metadata = { title: "Agent updates" };

type Release = {
  id: string; version_code: number; version_name: string; active: boolean;
  sha256: string | null; notes: string | null; created_at: string;
};

export default async function AgentPage() {
  const staff = await requireStaff();
  if (staff.role !== "super_admin") redirect("/devices");

  const supabase = await createClient();
  const [{ data: releases }, { data: devices }] = await Promise.all([
    supabase.from("agent_releases").select("id, version_code, version_name, active, sha256, notes, created_at")
      .order("version_code", { ascending: false }),
    supabase.from("devices").select("agent_version").not("status", "in", "(pending,retired)").limit(10000),
  ]);

  const fleet = new Map<string, number>();
  for (const d of devices ?? []) fleet.set(d.agent_version ?? "unknown", (fleet.get(d.agent_version ?? "unknown") ?? 0) + 1);

  return (
    <>
      <PageHeader title="Agent updates" description="Publish a new PrimeSecure agent; every enrolled Primebook installs it silently." />
      <div className="card mb-6 p-4"><PublishRelease /></div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card divide-y divide-slate-100 lg:col-span-2">
          <h2 className="p-4 font-semibold">Releases</h2>
          {(releases ?? []).length === 0 && <p className="p-4 text-sm text-slate-500">Nothing published yet.</p>}
          {((releases ?? []) as Release[]).map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="font-medium">
                  {r.version_name} <span className="text-sm text-slate-500">({r.version_code})</span>
                  {!r.active && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">paused</span>}
                </div>
                <div className="text-xs text-slate-500">{dateTime(r.created_at)}{r.notes && ` · ${r.notes}`}</div>
                {r.sha256 && <div className="font-mono text-xs text-slate-400">sha256 {r.sha256.slice(0, 16)}…</div>}
              </div>
              <ReleaseActions id={r.id} active={r.active} />
            </div>
          ))}
        </section>

        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Fleet</h2>
          <ul className="space-y-1 text-sm">
            {[...fleet.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => (
              <li key={v} className="flex justify-between"><span className="font-mono">{v}</span><span>{n}</span></li>
            ))}
            {fleet.size === 0 && <li className="text-slate-500">No enrolled devices.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}
