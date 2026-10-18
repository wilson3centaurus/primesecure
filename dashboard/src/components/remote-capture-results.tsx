import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { dateTime } from "@/lib/format";

export async function RemoteCaptureResults({ deviceId, caseId }: { deviceId: string; caseId?: string }) {
  const db = await createClient();
  let query = db.from("remote_capture_sessions").select("command_id,case_id,kind,state,expires_at,created_at").eq("device_id", deviceId).order("created_at", { ascending: false }).limit(10);
  if (caseId) query = query.eq("case_id", caseId);
  const { data, error } = await query;
  if (error) return <p className="mt-3 text-xs text-amber-700">Capture history unavailable. Apply the visible remote-controls migration before using these controls.</p>;
  if (!data?.length) return null;
  return <section className="mt-3 space-y-2" aria-label="Visible capture requests"><h3 className="text-sm font-semibold">Capture requests</h3>{data.map(row => {
    return <div className="rounded-lg border border-slate-200 p-3 text-xs" key={row.command_id}>
      <p>{row.kind === "photo" ? "Camera photo" : "Screenshot"} · {row.state === "completed" ? "Student shared an image" : row.state === "offered" ? "Offered to student; no image shared" : row.state === "consented" ? "Student allowed; no image shared yet" : row.state}</p>
      <p className="mt-1 text-slate-500">Requested {dateTime(row.created_at)}</p>
      {row.state !== "completed" && <p className="mt-1 text-slate-500">Request deadline: {dateTime(row.expires_at)}. Expired requests cannot capture or send.</p>}
      {row.state === "completed" && <Link prefetch={false} href={`/api/remote-capture/${row.command_id}`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-medium text-brand-700 underline">View private image (expires after 7 days)</Link>}
    </div>;
  })}</section>;
}
