"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Zip, ZipPassThrough, strToU8 } from "fflate";

const exports = [
  { kind: "wallpapers", label: "Download wallpapers", detail: "Images and catalogue manifest" },
  { kind: "apps", label: "Download apps", detail: "APK/PSAPK files and package metadata" },
  { kind: "school-notes", label: "Download school notes", detail: "Books and notes in their form/subject folders" },
] as const;

type ExportKind = (typeof exports)[number]["kind"];
type ExportItem = { archive_path: string; signed_url: string; size: number; [key: string]: unknown };
type ExportManifest = { created_at: string; export: ExportKind; items: ExportItem[]; [key: string]: unknown };

async function saveSlowNetworkZip(kind: ExportKind) {
  const picker = (window as typeof window & { showSaveFilePicker?: (options: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (!picker) {
    const fallback = document.createElement("a");
    fallback.href = `/api/factory-content/${kind}`;
    fallback.click();
    return;
  }
  const handle = await picker({
    suggestedName: `robokorda-${kind}-${new Date().toISOString().slice(0, 10)}.zip`,
    types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
  });
  const output = await handle.createWritable();
  const response = await fetch(`/api/factory-content/${kind}?mode=manifest`, { cache: "no-store" });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Could not prepare the export.");
  const manifest = await response.json() as ExportManifest;
  let pendingWrite = Promise.resolve();
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    pendingWrite = pendingWrite.then(() => output.write(chunk));
  });
  try {
    for (const item of manifest.items) {
      const fileResponse = await fetch(item.signed_url, { cache: "no-store" });
      if (!fileResponse.ok || !fileResponse.body) throw new Error(`Could not download ${item.archive_path}.`);
      const entry = new ZipPassThrough(item.archive_path);
      zip.add(entry);
      const reader = fileResponse.body.getReader();
      let bytes = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        entry.push(value);
        await pendingWrite;
      }
      entry.push(new Uint8Array(0), true);
      await pendingWrite;
      if (bytes !== Number(item.size)) throw new Error(`Size check failed for ${item.archive_path}.`);
    }
    const cleanManifest = { ...manifest, items: manifest.items.map((item) => {
      const clean = { ...item };
      delete clean.signed_url;
      return clean;
    }) };
    const manifestEntry = new ZipPassThrough("manifest.json");
    zip.add(manifestEntry);
    manifestEntry.push(strToU8(`${JSON.stringify(cleanManifest, null, 2)}\n`), true);
    zip.end();
    await pendingWrite;
    await output.close();
  } catch (error) {
    await output.abort(error).catch(() => undefined);
    throw error;
  }
}

export function FactoryContentExports() {
  const [busy, setBusy] = useState<ExportKind>();
  const [message, setMessage] = useState<string>();
  return (
    <section className="card mb-5 max-w-4xl p-5">
      <h2 className="text-sm font-semibold">Factory preload exports</h2>
      <p className="mt-2 text-sm text-slate-500">
        Download a versioned snapshot of the content currently available to this school. These ZIP files preserve
        the catalogue folders, metadata and hashes used by PrimeSecure, so they can be copied into an offline USB
        factory preload. Content added after the snapshot will continue to sync online.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {exports.map((item) => (
          <button key={item.kind} type="button" disabled={Boolean(busy)}
            className="rounded-xl border border-line bg-panel p-4 text-left transition hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50"
            onClick={() => { setBusy(item.kind); setMessage(`Preparing ${item.label.toLowerCase()}…`); void saveSlowNetworkZip(item.kind)
              .then(() => setMessage(`${item.label} finished.`))
              .catch((error) => setMessage(error instanceof Error ? error.message : "Export failed."))
              .finally(() => setBusy(undefined)); }}>
            <span className="flex items-center gap-2 text-sm font-semibold text-brand-700"><Download size={16} />{busy === item.kind ? "Downloading…" : item.label}</span>
            <span className="mt-2 block text-xs text-muted">{item.detail}</span>
          </button>
        ))}
      </div>
      {message && <p role="status" className="mt-3 text-xs text-muted">{message}</p>}
      <p className="mt-3 text-xs text-muted">Chrome and Edge stream large ZIPs directly to disk for slow connections. Keep this tab open until the export finishes.</p>
    </section>
  );
}
