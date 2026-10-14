"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import type { FormState } from "@/lib/types";
import { sendMessage, prepareMessageImageUpload } from "@/app/(app)/commands/actions";
import { FormMessage } from "@/components/form-message";

// target: a device id, or "school" for every enrolled device in the current school.
export function MessageForm({ target, collapsible = false, label = "Send message", groups = [] }: { target: string; collapsible?: boolean; label?: string; groups?: {form_level:string;class_name:string}[] }) {
  const [open, setOpen] = useState(!collapsible);
  const [state, setState] = useState<FormState>();
  const [busy, setBusy] = useState(false);
  const [formLevel,setFormLevel]=useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const image = data.get("image") as File; data.delete("image");
    setBusy(true); setState(undefined);
    let uploaded: string | undefined;
    try {
      if (image?.size) {
        if (image.size > 3_000_000 || !["image/jpeg", "image/png", "image/webp"].includes(image.type)) throw new Error("Choose a JPG, PNG or WebP smaller than 3 MB.");
        const client = createClient();
        const scope = await prepareMessageImageUpload(target, image.type);
        if (scope.error || !scope.path) throw new Error(scope.error || "Select a school before uploading.");
        uploaded = scope.path;
        const { error } = await client.storage.from("primesecure-messages").upload(uploaded, image, { contentType: image.type });
        if (error) throw error;
        data.set("image_path", uploaded);
      }
      const result = await sendMessage(undefined, data);
      if (result?.error && uploaded) await createClient().storage.from("primesecure-messages").remove([uploaded]);
      setState(result);
    } catch(e) { setState({ error: e instanceof Error ? e.message : "Message could not be sent." }); }
    finally { setBusy(false); }
  }

  if (!open) return <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>{label}</button>;

  return (
    <form onSubmit={submit} className={`space-y-3 ${collapsible ? "card w-full p-4" : ""}`}>
      <input type="hidden" name="target" value={target} />
      {target === "school" && <div className="grid grid-cols-2 gap-3"><label className="label">Form<select name="form_level" className="input" value={formLevel} onChange={e=>setFormLevel(e.target.value)}><option value="">All forms</option>{[...new Set(groups.map(g=>g.form_level))].sort().map(f=><option key={f}>{f}</option>)}</select></label><label className="label">Class<select name="class_name" className="input" key={formLevel}><option value="">All classes</option>{[...new Set(groups.filter(g=>!formLevel||g.form_level===formLevel).map(g=>g.class_name))].filter(Boolean).sort().map(c=><option key={c}>{c}</option>)}</select></label></div>}
      <input name="title" placeholder="Title (optional)" aria-label="Title" maxLength={80} className="input" />
      <textarea name="body" required rows={3} maxLength={12000} aria-label="Message"
        placeholder={target === "school" ? "Shown on every Primebook in the school" : "Shown on the student's screen"} className="input" />
      <details className="text-sm text-slate-600"><summary className="cursor-pointer">Images and tables</summary>
        <label className="label mt-3">Upload image (up to 3 MB)<input name="image" type="file" accept="image/jpeg,image/png,image/webp" className="input" /></label>
        <label className="label">Or image URL<input name="image_url" type="url" placeholder="https://…" className="input" /></label>
        <p className="my-2 text-xs">Uploaded images are private to your school. Use # for a heading. Create table rows using pipes, for example:</p>
        <pre className="rounded-lg bg-slate-50 p-3 text-xs">{"| Subject | Time |\n| Maths | 09:00 |\n| English | 10:00 |"}</pre>
      </details>
      <label className="flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-sm"><input type="checkbox" name="require_ack" className="mt-1" /><span><strong>Acknowledgement required</strong><br />Student must select “I acknowledge” to dismiss the notice.</span></label>
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={busy}>{busy ? "Uploading & sending…" : target === "school" ? "Send to selected students" : "Send"}</button>
        {collapsible && <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Close</button>}
        <FormMessage state={state} />
      </div>
    </form>
  );
}
