"use client";

import { useState, useTransition } from "react";
import { addApp } from "./actions";
import { FormMessage } from "@/components/form-message";
import { createClient } from "@/lib/supabase/browser";
import type { FormState } from "@/lib/types";

export function UploadApp({ schoolId }: { schoolId: string }) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<FormState>();
  const [busy, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setState({ error: "Choose an APK file." });
    if (!file.name.toLowerCase().endsWith(".apk")) return setState({ error: "That isn't an .apk file." });
    startTransition(async () => {
      setState(undefined);
      const supabase = createClient();
      const path = `${schoolId}/${crypto.randomUUID()}.apk`;
      const { error } = await supabase.storage
        .from("apks")
        .upload(path, file, { contentType: "application/vnd.android.package-archive" });
      if (error) return setState({ error: `Upload failed: ${error.message}` });
      const result = await addApp({ name: name || file.name.replace(/\.apk$/i, ""), storagePath: path, size: file.size });
      setState(result);
      if (result?.ok) { setName(""); setFile(null); (e.target as HTMLFormElement).reset(); }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="apk" className="label">APK file</label>
        <input id="apk" type="file" accept=".apk,application/vnd.android.package-archive" required
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block text-sm" />
      </div>
      <div className="min-w-56 flex-1">
        <label htmlFor="app-name" className="label">Name</label>
        <input id="app-name" value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="e.g. Kolibri" />
      </div>
      <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Uploading…" : "Add to library"}</button>
      <div className="w-full"><FormMessage state={state} /></div>
    </form>
  );
}
