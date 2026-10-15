"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type DeviceEvent = {
  id: string; occurred_at: string; received_at: string; severity: string;
  category: string; code: string; version: string; details: Record<string, unknown>;
  occurredLabel: string; receivedLabel: string;
};

export function DeviceDiagnostics({ events, unavailable, currentVersion }: { events: DeviceEvent[]; unavailable: boolean; currentVersion: string | null }) {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [versionScope, setVersionScope] = useState("current");
  const [search, setSearch] = useState("");
  const currentEvents = currentVersion ? events.filter((event) => event.version === currentVersion) : [];
  const currentIssues = currentEvents.filter((event) => event.severity !== "info").length;
  const historicalIssues = currentVersion ? events.filter((event) => event.version !== currentVersion && event.severity !== "info").length : 0;
  const scoped = versionScope === "current" && currentVersion ? currentEvents : events;
  const visible = scoped.filter((event) => {
    const severity = filter === "all" || (filter === "issues" ? event.severity !== "info" : event.category === "boot" || event.category === "policy" || event.category === "safety");
    return severity && `${event.code} ${event.category} ${JSON.stringify(event.details)}`.toLowerCase().includes(search.toLowerCase());
  });
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(visible, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "primesecure-diagnostics.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="card p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Device diagnostics</h2><button className="btn-secondary py-1.5" onClick={() => router.refresh()}>Refresh logs</button></div>
    <p className="mt-2 text-xs text-slate-500">Recent device-reported events. Offline entries upload after reconnection. Requires agent 0.6.5 or newer.</p>
    {!unavailable && currentVersion && <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm" role="status">
      <p className="font-medium">Installed agent {currentVersion}</p>
      <p className="mt-1 text-slate-600">{currentEvents.length
        ? `${currentEvents.length} events · ${currentIssues} errors or warnings in the loaded logs from this version.`
        : "No events received from this version in the latest 100 records. Open PrimeSecure, let it sync, then refresh."}</p>
      {currentEvents[0] && <p className="mt-1 text-xs text-slate-500">Latest upload: {currentEvents[0].receivedLabel}. This is a log summary, not confirmation that every device function has been tested.</p>}
      {historicalIssues > 0 && <p className="mt-1 text-xs text-slate-500">{historicalIssues} older-version errors or warnings are retained in history. Select “All versions (history)” to review them.</p>}
    </div>}
    <div className="my-3 flex flex-wrap gap-2">
      <select aria-label="Diagnostic version filter" className="input w-auto" value={currentVersion ? versionScope : "all"} onChange={(event) => setVersionScope(event.target.value)} disabled={!currentVersion}><option value="current">Installed agent{currentVersion ? ` (${currentVersion})` : ""}</option><option value="all">All versions (history)</option></select>
      <select aria-label="Diagnostic event filter" className="input w-auto" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="issues">Errors &amp; warnings</option><option value="all">All events</option><option value="boot">Boot &amp; policy</option></select>
      <input aria-label="Search diagnostics" className="input min-w-32 flex-1" placeholder="Search event or app package" value={search} onChange={(event) => setSearch(event.target.value)}/>
      <button className="btn-secondary" disabled={visible.length === 0} onClick={download}>Export JSON</button>
    </div>
    {unavailable ? <p className="text-sm text-amber-700">Logs could not be loaded. Check the server logging update, then refresh.</p> : visible.length === 0 ? <p className="py-3 text-sm text-slate-500">{scoped.length && filter === "issues" && !search ? "No errors or warnings in the loaded logs for this version selection." : events.length ? "No events match this filter." : "No logs received yet. Install the logging agent and let it check in."}</p> : <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">{visible.map((event) => <details key={event.id} className="py-2">
      <summary className="cursor-pointer text-sm"><span className={event.severity === "fatal" || event.severity === "error" ? "font-medium text-red-700" : event.severity === "warning" ? "font-medium text-amber-700" : "text-slate-600"}>{event.severity}</span><span className="ml-2">{event.code.replaceAll("_", " ")}</span><span className="ml-2 text-xs text-slate-500">{event.version}{currentVersion && event.version !== currentVersion ? " · Historical" : ""}</span><span className="ml-2 text-xs text-slate-400">{event.occurredLabel}</span></summary>
      <p className="mt-2 text-xs text-slate-500">{event.category} · agent {event.version} · received {event.receivedLabel}</p>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 text-xs">{JSON.stringify(event.details, null, 2)}</pre>
    </details>)}</div>}
    <p className="mt-3 text-xs text-slate-400">Showing up to 100 recent events. The server retains up to 1,000 per device. These are PrimeSecure diagnostics, not a complete PrimeOS or kernel log.</p>
  </section>;
}
