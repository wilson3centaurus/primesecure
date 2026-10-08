"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deleteFile, getCommand, listFiles, pushFile } from "@/app/(app)/files/actions";
import { uploadMedia } from "@/lib/upload-media";

type Entry = { name: string; dir: boolean; size: number | null; modified: number };
type Listing = { path: string; entries: Entry[]; truncated: boolean; free_bytes?: number };

function bytes(n: number | null | undefined) {
  if (n == null) return "";
  if (n > 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n > 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.ceil(n / 1024)} KB`;
}

// Commands are answered asynchronously by the device; poll until it reports back.
async function waitFor(id: string, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const c = await getCommand(id);
    if (c && (c.status === "succeeded" || c.status === "failed" || c.status === "cancelled")) return c;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

export function FileBrowser({ deviceId, schoolId }: { deviceId: string; schoolId: string }) {
  const [path, setPath] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [status, setStatus] = useState("Asking the device…");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef(0);

  // Asks the device for a folder listing; state updates only after the first await.
  const fetchListing = useCallback(async (p: string) => {
    const mine = ++request.current;
    const { commandId, error } = await listFiles(deviceId, p);
    if (mine !== request.current) return;
    if (error || !commandId) { setBusy(false); setStatus(""); return setError(error ?? "Failed."); }
    const c = await waitFor(commandId);
    if (mine !== request.current) return;
    setBusy(false); setStatus("");
    if (!c) return setError("The device didn't answer within a minute. Is it online?");
    if (c.status !== "succeeded") return setError(String(c.result?.error ?? "Failed."));
    setListing(c.result as unknown as Listing);
  }, [deviceId]);

  // Initial listing of the storage root (deferred: an effect must not set state synchronously).
  useEffect(() => {
    const t = setTimeout(() => fetchListing(""), 0);
    return () => clearTimeout(t);
  }, [fetchListing]);

  function open(p: string) {
    setPath(p); setBusy(true); setError(""); setStatus("Asking the device…");
    fetchListing(p);
  }
  async function run(label: string, start: () => Promise<{ commandId?: string; error?: string }>) {
    setBusy(true); setError(""); setStatus(label);
    const { commandId, error } = await start();
    if (error || !commandId) { setBusy(false); setStatus(""); return setError(error ?? "Failed."); }
    const c = await waitFor(commandId, 10 * 60_000);
    setBusy(false); setStatus("");
    if (!c) return setError("The device didn't finish in time; check the command history.");
    if (c.status !== "succeeded") return setError(String(c.result?.error ?? "Failed."));
    open(path);
  }

  async function upload(file: File) {
    setBusy(true); setError(""); setStatus(`Uploading ${file.name}…`);
    const { path: storagePath, error } = await uploadMedia(schoolId, file);
    if (error || !storagePath) { setBusy(false); setStatus(""); return setError(`Upload failed: ${error}`); }
    await run(`Sending ${file.name} to the device…`, () => pushFile(deviceId, storagePath, [path, file.name].filter(Boolean).join("/")));
  }

  const crumbs = path ? path.split("/") : [];

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-3">
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          <button className="text-brand-700 hover:underline" onClick={() => open("")} disabled={busy}>Storage</button>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-slate-400">/</span>
              <button className="text-brand-700 hover:underline" disabled={busy}
                onClick={() => open(crumbs.slice(0, i + 1).join("/"))}>{c}</button>
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <button className="btn-secondary py-1.5" onClick={() => open(path)} disabled={busy}>Refresh</button>
          <button className="btn-primary py-1.5" onClick={() => fileInput.current?.click()} disabled={busy}>Upload here</button>
          <input ref={fileInput} type="file" className="hidden" aria-label="File to send"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
        </div>
      </div>

      {(status || error) && (
        <div className={`border-b border-slate-200 px-3 py-2 text-sm ${error ? "text-red-600" : "text-slate-600"}`}>{error || status}</div>
      )}

      <ul className="divide-y divide-slate-100 text-sm">
        {listing?.entries.length === 0 && <li className="p-3 text-slate-500">Empty folder.</li>}
        {listing?.entries.map((e) => {
          const full = [listing.path, e.name].filter(Boolean).join("/");
          return (
            <li key={e.name} className="flex items-center justify-between gap-3 px-3 py-2">
              {e.dir ? (
                <button className="truncate text-left font-medium text-brand-700 hover:underline" disabled={busy}
                  onClick={() => open(full)}>📁 {e.name}</button>
              ) : (
                <span className="truncate">📄 {e.name}</span>
              )}
              <span className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
                {bytes(e.size)}
                <span>{new Date(e.modified).toLocaleDateString("en-GB")}</span>
                <button className="text-red-600 underline" disabled={busy}
                  onClick={() => {
                    if (!confirm(`Delete ${e.name}${e.dir ? " and everything in it" : ""} from the device?`)) return;
                    run(`Deleting ${e.name}…`, () => deleteFile(deviceId, full, e.dir));
                  }}>Delete</button>
              </span>
            </li>
          );
        })}
      </ul>
      {listing && (
        <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
          {listing.truncated && "Showing the first 500 entries. "}
          {listing.free_bytes != null && `${bytes(listing.free_bytes)} free`}
        </div>
      )}
    </div>
  );
}
