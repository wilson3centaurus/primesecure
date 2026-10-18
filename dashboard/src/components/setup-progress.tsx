import { dateTime } from "@/lib/format";
import { SETUP_STREAMS, effectiveWallpaper, setupDuration, setupReport, streamPercent, type SetupRecord, type SetupSummary } from "@/lib/setup-progress";
import { createClient } from "@/lib/supabase/server";
import { canManage, requireStaff } from "@/lib/auth";
import { cache } from "react";

const colors = { wallpaper: "accent-fuchsia-600", app: "accent-indigo-600", resource: "accent-emerald-600" };
// React's server-request cache gives every row the same stable freshness reference.
const requestTime = cache(() => Date.now());

export function SetupProgressBars({ record, compact = false }: { record?: SetupRecord | null; compact?: boolean }) {
  const report = setupReport(record?.report);
  if (!report) return <p className="text-xs text-slate-500">Not yet reported. Updated agent and a received school catalogue are required.</p>;
  const reportedAt = record ? Date.parse(record.reported_at) : NaN;
  const stale = !Number.isFinite(reportedAt) || requestTime() - reportedAt > 5 * 60_000;
  return <div className="space-y-2" aria-label="Setup download streams">
    {report.streams.map((stream) => <div key={stream.kind}>
      <div className="flex justify-between gap-3 text-xs"><span>{stream.label}</span><span>{stream.completed_items}/{stream.total_items}{stream.complete ? " · Ready" : " · Pending"}</span></div>
      <progress aria-label={`${stream.label}: ${stream.completed_items} of ${stream.total_items} items ready`} max={100} value={streamPercent(stream)} className={`mt-1 h-2 w-full ${colors[stream.kind]}`} />
      {!compact && <p className="text-xs text-slate-500">{(stream.completed_bytes / 1_048_576).toFixed(1)} / {(stream.total_bytes / 1_048_576).toFixed(1)} MB received or already present · {stream.complete ? "Observed ready after" : "Elapsed, not an ETA"}: {setupDuration(stream.elapsed_ms)}</p>}
    </div>)}
    <p className={`text-xs ${stale ? "text-amber-700" : "text-slate-500"}`}>Last reported {dateTime(record?.reported_at ?? null)}{stale ? " · Stale / possibly offline; current progress is unknown." : " · Device-reported, not a live connection."}</p>
    {!compact && <p className="text-xs text-slate-500">{report.complete ? `Catalogue ready after ${setupDuration(report.elapsed_ms)}.` : "Catalogue downloads are not yet complete."} Durations begin when this catalogue was first observed, include offline/queue waiting, and reset when its contents change. They do not measure enrollment or policy completion.{report.clock_estimated ? " This duration includes an estimated reboot/clock gap." : ""}</p>}
  </div>;
}

export function SchoolSetupSummary({ summary, unavailable = false }: { summary: SetupSummary | null; unavailable?: boolean }) {
  return <section className="card mb-5 p-4" aria-label="School setup averages">
    <h2 className="font-semibold">Primebook download setup</h2>
    {!summary ? <p className="mt-2 text-sm text-slate-500">{unavailable ? "Setup reporting is unavailable. Apply the setup-progress migration and update the agents." : "No setup reports yet."}</p> : <>
      <p className="mt-2 text-sm text-slate-600">{summary.complete_devices} of {summary.reporting_devices} reporting Primebooks have their current catalogue ready. Average completed setup: {setupDuration(summary.avg_setup_ms)} ({summary.setup_samples} non-empty completed samples).</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">{SETUP_STREAMS.map(({ kind, label }) => {
        const stream = summary.streams.find((s) => s.kind === kind);
        return <div key={kind} className="rounded-lg bg-slate-50 p-3"><p className="text-sm font-medium">{label}</p><p className="mt-1 text-sm">{setupDuration(stream?.avg_elapsed_ms)}</p><p className="text-xs text-slate-500">{stream?.samples ?? 0} non-empty ready streams</p></div>;
      })}</div>
    </>}
    <p className="mt-3 text-xs text-slate-500">Averages use only the latest completed catalogue reports, not unfinished devices or empty streams. Stream durations are time to readiness since the catalogue was first seen, including earlier streams and offline time—not active transfer speed or a promised finish time. Old agents and devices that have not reported are excluded.</p>
  </section>;
}

export async function DeviceSetupProgress({ deviceId }: { deviceId: string }) {
  const db = await createClient();
  const { data, error } = await db.from("device_setup_progress").select("device_id,reported_at,report").eq("device_id", deviceId).maybeSingle();
  return <section className="card p-4"><h2 className="mb-3 font-semibold">Setup downloads</h2>{error ? <p className="text-sm text-slate-500">Setup reports are unavailable; check the setup migration and updated agent.</p> : <SetupProgressBars record={data} />}</section>;
}

export async function DeviceWallpaper({ deviceId, schoolId }: { deviceId: string; schoolId: string }) {
  const staff = await requireStaff();
  if (!canManage(staff, schoolId)) return null;
  const db = await createClient();
  const [deviceResult, settingsResult] = await Promise.all([
    db.from("devices").select("wallpaper_choice_id").eq("id", deviceId).eq("school_id", schoolId).maybeSingle(),
    db.from("hub_settings").select("scope,school_id,default_wallpaper_id,allow_wallpaper_choice").or(`scope.eq.global,school_id.eq.${schoolId}`),
  ]);
  // Never expose even a configured school preview for a nonexistent/cross-school device.
  if (!deviceResult.data) return <section className="card p-4"><h2 className="mb-3 font-semibold">Student wallpaper</h2><p className="text-sm text-slate-500">Device wallpaper is unavailable.</p></section>;
  const choice = deviceResult.data.wallpaper_choice_id as string | null;
  const settings = settingsResult.data ?? [];
  const candidates = [...new Set([choice, ...settings.map((setting) => setting.default_wallpaper_id)].filter((id): id is string => !!id))];
  const [items, access] = candidates.length ? await Promise.all([
    db.from("hub_items").select("id,title,storage_path,school_id,published").in("id", candidates).eq("kind", "wallpaper").eq("published", true),
    db.from("hub_access").select("item_id").eq("school_id", schoolId).in("item_id", candidates),
  ]) : [{ data: [] }, { data: [] }];
  const wallpaper = effectiveWallpaper(schoolId, choice, settings, items.data ?? [], (access.data ?? []).map((row) => row.item_id));
  const item = wallpaper?.item;
  const { data: preview } = item ? await db.storage.from("primesecure-hub").createSignedUrl(item.storage_path, 180) : { data: null };
  return <section className="card p-4"><h2 className="mb-3 font-semibold">Student wallpaper</h2>
    {item ? <><p className="text-sm font-medium">{item.title}</p><p className="mt-1 text-xs text-slate-500">{wallpaper.label}</p>{preview?.signedUrl ?
      // eslint-disable-next-line @next/next/no-img-element -- short-lived private signed URL, not public optimization.
      <img src={preview.signedUrl} alt={`${wallpaper.label}: ${item.title}`} width={400} height={225} className="mt-3 max-h-56 w-full rounded-xl object-contain" /> : <p className="mt-2 text-xs text-slate-500">Private preview unavailable.</p>}</> : <p className="text-sm text-slate-500">No available student choice or published school/master default. The existing device wallpaper policy may apply.</p>}
    <p className="mt-2 text-xs text-slate-500">Last synced choice or inherited configuration, not a screenshot or proof of the wallpaper currently applied. Offline changes appear after sync.</p>
  </section>;
}
