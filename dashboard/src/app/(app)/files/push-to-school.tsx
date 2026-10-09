"use client";

import { useState } from "react";
import { pushFile } from "./actions";
import { uploadMedia } from "@/lib/upload-media";

export function PushToSchool({ schoolId }: { schoolId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [folder, setFolder] = useState("Download/School");
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setMsg({ error: "Choose a file." });
    setBusy(true); setMsg({});
    const { path, error } = await uploadMedia(schoolId, file);
    if (error || !path) { setBusy(false); return setMsg({ error: `Upload failed: ${error}` }); }
    const r = await pushFile("school", path, [folder, file.name].filter(Boolean).join("/"));
    setBusy(false);
    setMsg(r.error ? { error: r.error } : { ok: `Sending to ${r.count} devices. Offline devices get it when they reconnect.` });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="push-file" className="label">File</label>
          <input id="push-file" type="file" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block text-sm" />
        </div>
        <div className="min-w-56 flex-1">
          <label htmlFor="push-folder" className="label">Folder on the device</label>
          <input id="push-folder" value={folder} onChange={(e) => setFolder(e.target.value)} className="input font-mono" />
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Sending…" : "Send to all devices"}</button>
      </div>
      {msg.error && <p className="text-sm text-red-600">{msg.error}</p>}
      {msg.ok && <p className="text-sm text-green-700">{msg.ok}</p>}
    </form>
  );
}
