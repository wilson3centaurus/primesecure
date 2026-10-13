"use client";
import { useActionState, useState } from "react";
import { publishItem, changeLibraryItem, saveHubSettings, reviewAppRequest } from "@/app/(app)/library/actions";
import { createClient } from "@/lib/supabase/browser";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";
import type { FormState } from "@/lib/types";

export function HubUpload({ kind, schoolId, superAdmin }: { kind: string; schoolId: string; superAdmin: boolean }) {
  const [state, setState] = useState<FormState>(); const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const file = data.get("file") as File;
    if (!file?.size) return setState({ error: "Choose a file." });
    if (kind === "wallpaper" && file.size > 8_000_000) return setState({ error: "Wallpapers must be smaller than 8 MB." });
    const shared = data.get("shared") === "on";
    const path = `${shared ? "shared" : schoolId}/${crypto.randomUUID()}/${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    setBusy(true); setState(undefined);
    try {
      const supabase = createClient();
      const { error } = await supabase.storage.from("primesecure-hub").upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (error) throw error;
      const result = await publishItem({ kind, path, shared, title: String(data.get("title")), description: String(data.get("description") || ""), form: String(data.get("form") || ""), subject: String(data.get("subject") || ""), category: String(data.get("category") || "Notes"), size: file.size, mime: file.type || "application/octet-stream", packageName: String(data.get("package") || ""), preinstall: data.get("preinstall") === "on" });
      if (result?.error) await supabase.storage.from("primesecure-hub").remove([path]);
      setState(result); if (result?.ok) form.reset();
    } catch (e) { setState({ error: e instanceof Error ? e.message : "Upload failed." }); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
    <label className="label">Title<input name="title" required maxLength={160} className="input mt-1" placeholder={kind === "resource" ? "e.g. Algebra revision guide" : "Name students will see"} /></label>
    <label className="label">File<input name="file" type="file" required accept={kind === "app" ? ".apk" : kind === "wallpaper" ? "image/png,image/jpeg,image/webp" : undefined} className="input mt-1" /></label>
    <label className="label md:col-span-2">Description<textarea name="description" maxLength={2000} className="input mt-1" rows={2} /></label>
    {kind === "resource" && <><label className="label">Form<select name="form" className="input mt-1">{[1,2,3,4,5,6].map(n => <option key={n}>Form {n}</option>)}<option>All levels</option></select></label><label className="label">Subject<input name="subject" required placeholder="Mathematics" maxLength={100} className="input mt-1" /></label><label className="label">Resource folder<select name="category" className="input mt-1">{["Notes", "Past exam papers", "Textbooks", "Images", "Videos", "Other resources"].map(c => <option key={c}>{c}</option>)}</select></label></>}
    {kind === "app" && <><label className="label">Android package name<input name="package" required placeholder="org.example.learning" className="input mt-1" /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="preinstall" /> Automatically install on enrolled devices</label></>}
    {superAdmin && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="shared" /> Shared RoboKorda library (schools opt in)</label>}
    <div className="flex items-center gap-4 md:col-span-2"><button className="btn-primary" disabled={busy}>{busy ? "Uploading…" : "Publish to library"}</button><FormMessage state={state} /></div>
  </form>;
}

export function HubItemAction({ id, action, children }: { id: string; action: string; children: React.ReactNode }) {
  const [state, run] = useActionState(changeLibraryItem, undefined);
  return <form action={run}><input type="hidden" name="id" value={id} /><input type="hidden" name="action" value={action} /><SubmitButton className="btn-secondary">{children}</SubmitButton><FormMessage state={state} /></form>;
}
export type HubSettings = { default_wallpaper_id: string | null; allow_wallpaper_choice: boolean; hide_vendor_store: boolean };
export function HubSettingsForm({ wallpapers, settings, global = false }: { wallpapers: {id: string; title: string}[]; settings: HubSettings | null; global?: boolean }) {
  const [state, action] = useActionState(saveHubSettings, undefined);
  return <form action={action} className="space-y-4">
    {global && <input type="hidden" name="global" value="on" />}
    <label className="label">Default wallpaper<select name="wallpaper" defaultValue={settings?.default_wallpaper_id || ""} className="input mt-1"><option value="">{global ? "Use existing device wallpaper policy" : "Inherit master wallpaper"}</option>{wallpapers.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}</select></label>
    <label className="flex gap-2 text-sm"><input name="allow_choice" type="checkbox" defaultChecked={settings?.allow_wallpaper_choice ?? true} /> Let students choose approved wallpapers</label>
    <label className="flex gap-2 text-sm"><input name="hide_vendor_store" type="checkbox" defaultChecked={settings?.hide_vendor_store ?? false} /> Hide Primebook App Store and block outside APK installs</label>
    <SubmitButton>Save {global ? "master" : "school"} defaults</SubmitButton><FormMessage state={state} />
  </form>;
}
export function ReviewRequest({ id, status }: { id: string; status: string }) {
  const [state, action] = useActionState(reviewAppRequest, undefined);
  return <form action={action} className="flex flex-wrap gap-2"><input type="hidden" name="id" value={id} /><select name="status" defaultValue={status === "requested" ? "reviewing" : status} className="input w-auto"><option value="reviewing">Reviewing</option><option value="approved">Approved</option><option value="declined">Declined</option></select><SubmitButton>Save</SubmitButton><FormMessage state={state} /></form>;
}
