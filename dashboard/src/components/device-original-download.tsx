"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Download } from "lucide-react";
import { getOriginalFile, requestOriginalFile, type OriginalFileStatus } from "@/app/(app)/files/actions";

export function DeviceOriginalDownload({ deviceId, path, size, modified }: { deviceId: string; path: string; size: number; modified: number }) {
  const [pending, startTransition] = useTransition();
  const [requestId, setRequestId] = useState("");
  const [result, setResult] = useState<OriginalFileStatus>({});
  const [watch, setWatch] = useState(false);
  const started = useRef(0);
  const generation = useRef(0);
  useEffect(() => {
    if (!requestId || !watch) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await getOriginalFile(requestId);
        if (cancelled) return;
        setResult(next);
        if (next.error || ["ready", "expired", "failed", "cancelled", "succeeded"].includes(next.status ?? "")) { setWatch(false); return; }
        if (Date.now() - started.current > 5 * 60_000) { setWatch(false); return; }
      } catch {
        if (cancelled) return;
        setResult({ error: "Connection interrupted. Check this request again; no need to reupload." });
        setWatch(false); return;
      }
      if (!cancelled) timer = setTimeout(() => startTransition(() => { void poll(); }), 3000);
    }
    timer = setTimeout(() => startTransition(() => { void poll(); }), 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [requestId, watch]);

  function request() {
    const mine = ++generation.current;
    startTransition(async () => {
      try {
        const next = await requestOriginalFile(deviceId, path, size, modified);
        if (generation.current !== mine) return;
        if (next.error || !next.requestId) { setResult({ error: next.error ?? "Could not request file." }); return; }
        setRequestId(next.requestId); setResult({ status: "pending" }); started.current = Date.now(); setWatch(true);
      } catch { setResult({ error: "Could not queue request. Check your connection." }); }
    });
  }
  function check() {
    setResult({ status: "pending" }); started.current = Date.now(); setWatch(true);
  }
  return <div className="mt-2 w-full text-xs" onClick={event => event.stopPropagation()}>
    {!requestId ? <button type="button" className="inline-flex items-center gap-1 text-brand-700 underline disabled:opacity-50" disabled={pending || size > 500_000_000}
      title={size > 500_000_000 ? "Original exceeds the 500 MB limit" : "Requests this original from the Primebook; an online device is required"} onClick={request}><Download size={13} />{pending ? "Requesting…" : "Download original"}</button>
      : result.downloadUrl ? <><a className="text-brand-700 underline" href={result.downloadUrl} download={result.filename}>Save original</a><button type="button" className="ml-2 text-slate-500 underline" onClick={check}>Refresh link</button><p className="mt-1 text-slate-400">Link lasts up to 60 seconds. Temporary copy expires within 24 hours.</p></>
      : <><span className="text-slate-500">{watch ? "Waiting for Primebook upload…" : result.status === "expired" ? "Temporary copy expired." : result.status === "failed" || result.status === "cancelled" ? "Request did not complete." : "Request queued; Primebook must be online."}</span>
        {!watch && <button type="button" className="ml-2 text-brand-700 underline" disabled={pending} onClick={result.status === "expired" || result.status === "failed" || result.status === "cancelled" ? request : check}>{result.status === "expired" || result.status === "failed" || result.status === "cancelled" ? "Request again" : "Check status"}</button>}</>}
    {result.error && <p role="alert" className="mt-1 break-words text-red-600">{result.error}</p>}
  </div>;
}
