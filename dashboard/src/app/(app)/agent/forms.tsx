"use client";

import { useActionState, useState } from "react";
import { addRelease, deleteRelease, setReleaseActive } from "./actions";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { createClient } from "@/lib/supabase/browser";
import type { FormState } from "@/lib/types";

async function sha256(file: File) {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function PublishRelease() {
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<FormState>();

  function pick(f: File | null) {
    setFile(f);
    // The release workflow names APKs primesecure-<version name>-<version code>.apk.
    const m = f?.name.match(/^primesecure-(.+)-(\d+)\.apk$/i);
    if (m) { setName(m[1]); setCode(m[2]); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setState({ error: "Choose the release APK." });
    setBusy(true); setState(undefined);
    const digest = await sha256(file);
    const path = `releases/${code}-${crypto.randomUUID()}.apk`;
    const { error } = await createClient().storage.from("agent")
      .upload(path, file, { contentType: "application/vnd.android.package-archive" });
    if (error) { setBusy(false); return setState({ error: `Upload failed: ${error.message}` }); }
    const result = await addRelease({ versionCode: Number(code), versionName: name, storagePath: path, sha256: digest, notes });
    setBusy(false);
    setState(result);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="release-apk" className="label">Release APK</label>
          <input id="release-apk" type="file" accept=".apk" required onChange={(e) => pick(e.target.files?.[0] ?? null)} className="block text-sm" />
        </div>
        <div className="w-36">
          <label htmlFor="version-code" className="label">Version code</label>
          <input id="version-code" value={code} onChange={(e) => setCode(e.target.value)} required inputMode="numeric" className="input" />
        </div>
        <div className="w-36">
          <label htmlFor="version-name" className="label">Version name</label>
          <input id="version-name" value={name} onChange={(e) => setName(e.target.value)} required className="input" />
        </div>
        <div className="min-w-48 flex-1">
          <label htmlFor="notes" className="label">Notes</label>
          <input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="input" placeholder="What changed" />
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Publishing…" : "Publish"}</button>
      </div>
      <p className="text-xs text-slate-500">
        Use the APK from the &ldquo;Agent (signed release APK)&rdquo; workflow. Devices check the version code and checksum
        before installing; a build signed with a different key is rejected by Android.
      </p>
      <FormMessage state={state} />
    </form>
  );
}

export function ReleaseActions({ id, active }: { id: string; active: boolean }) {
  const [toggleState, toggle] = useActionState(setReleaseActive, undefined);
  const [deleteState, remove] = useActionState(deleteRelease, undefined);
  return (
    <div className="flex items-center gap-3">
      <form action={toggle}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="active" value={String(!active)} />
        <SubmitButton className="btn-secondary py-1.5" pending="…">{active ? "Pause" : "Resume"}</SubmitButton>
      </form>
      <form action={remove}>
        <input type="hidden" name="id" value={id} />
        <SubmitButton className="text-sm text-red-600 underline" pending="…" confirm="Delete this release?">Delete</SubmitButton>
      </form>
      <FormMessage state={toggleState} />
      <FormMessage state={deleteState} />
    </div>
  );
}
