"use client";

import { useState } from "react";
import { Download } from "lucide-react";

const exports = [
  { kind: "wallpapers", label: "Download wallpapers", detail: "Images and catalogue manifest" },
  { kind: "apps", label: "Download apps", detail: "APK/PSAPK files and package metadata" },
  { kind: "school-notes", label: "Download school notes", detail: "Books and notes in their form/subject folders" },
] as const;

type ExportKind = (typeof exports)[number]["kind"];
type ExportItem = { archive_path: string; signed_url: string; size: number; [key: string]: unknown };
type ExportManifest = { items: ExportItem[]; [key: string]: unknown };
type Writable = { write(data: Uint8Array | string): Promise<void>; close(): Promise<void>; abort(reason?: unknown): Promise<void> };
type FileHandle = { getFile(): Promise<File>; createWritable(): Promise<Writable> };
type DirectoryHandle = {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
};

async function childDirectory(root: DirectoryHandle, parts: string[]) {
  let current = root;
  for (const part of parts) current = await current.getDirectoryHandle(part, { create: true });
  return current;
}

async function saveFactoryFolder(kind: ExportKind, progress: (message: string) => void) {
  const picker = (window as typeof window & { showDirectoryPicker?: () => Promise<DirectoryHandle> }).showDirectoryPicker;
  if (!picker) throw new Error("Use current Chrome or Edge to download this large factory preload.");
  const root = await picker();
  const response = await fetch(`/api/factory-content/${kind}?mode=manifest`, { cache: "no-store" });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Could not prepare the export.");
  const manifest = await response.json() as ExportManifest;
  let completed = 0;
  for (const item of manifest.items) {
    const parts = item.archive_path.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) throw new Error("The server returned an invalid factory path.");
    const directory = await childDirectory(root, parts);
    const handle = await directory.getFileHandle(fileName, { create: true });
    const existing = await handle.getFile();
    if (existing.size !== Number(item.size)) {
      const fileResponse = await fetch(item.signed_url, { cache: "no-store" });
      if (!fileResponse.ok || !fileResponse.body) throw new Error(`Could not download ${item.archive_path}.`);
      const output = await handle.createWritable();
      const reader = fileResponse.body.getReader();
      let bytes = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          await output.write(value);
        }
        if (bytes !== Number(item.size)) throw new Error(`Size check failed for ${item.archive_path}.`);
        await output.close();
      } catch (error) {
        await output.abort(error).catch(() => undefined);
        throw error;
      }
    }
    completed += 1;
    progress(`${completed} / ${manifest.items.length} files ready…`);
  }
  const exportRoot = await root.getDirectoryHandle(kind, { create: true });
  const manifestHandle = await exportRoot.getFileHandle("manifest.json", { create: true });
  const manifestOutput = await manifestHandle.createWritable();
  const cleanManifest = { ...manifest, items: manifest.items.map((item) => {
    return Object.fromEntries(Object.entries(item).filter(([key]) => key !== "signed_url"));
  }) };
  await manifestOutput.write(`${JSON.stringify(cleanManifest, null, 2)}\n`);
  await manifestOutput.close();
}

export function FactoryContentExports() {
  const [busy, setBusy] = useState<ExportKind>();
  const [message, setMessage] = useState<string>();
  return (
    <section className="card mb-5 max-w-4xl p-5">
      <h2 className="text-sm font-semibold">Factory preload exports</h2>
      <p className="mt-2 text-sm text-slate-500">
        Download a versioned snapshot of the content currently available to this school. Choose a destination folder;
        PrimeSecure preserves the catalogue hierarchy, metadata and hashes for offline USB preloading. Content added
        after the snapshot will continue to sync online.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {exports.map((item) => (
          <button key={item.kind} type="button" disabled={Boolean(busy)}
            className="rounded-xl border border-line bg-panel p-4 text-left transition hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50"
            onClick={() => { setBusy(item.kind); setMessage("Choose the destination folder…"); void saveFactoryFolder(item.kind, setMessage)
              .then(() => setMessage(`${item.label} finished and verified by size.`))
              .catch((error) => setMessage(error instanceof Error ? error.message : "Export failed."))
              .finally(() => setBusy(undefined)); }}>
            <span className="flex items-center gap-2 text-sm font-semibold text-brand-700"><Download size={16} />{busy === item.kind ? "Downloading…" : item.label}</span>
            <span className="mt-2 block text-xs text-muted">{item.detail}</span>
          </button>
        ))}
      </div>
      {message && <p role="status" className="mt-3 text-xs text-muted">{message}</p>}
      <p className="mt-3 text-xs text-muted">Use current Chrome or Edge. Interrupted exports can resume: files already present at the correct size are skipped.</p>
    </section>
  );
}
