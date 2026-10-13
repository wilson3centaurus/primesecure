"use client";

import { useActionState, useState } from "react";
import { sendMessage } from "@/app/(app)/commands/actions";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";

// target: a device id, or "school" for every enrolled device in the current school.
export function MessageForm({ target, collapsible = false, label = "Send message" }: { target: string; collapsible?: boolean; label?: string }) {
  const [open, setOpen] = useState(!collapsible);
  const [state, action] = useActionState(sendMessage, undefined);

  if (!open) return <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>{label}</button>;

  return (
    <form action={action} className={`space-y-3 ${collapsible ? "card w-full p-4" : ""}`}>
      <input type="hidden" name="target" value={target} />
      <input name="title" placeholder="Title (optional)" aria-label="Title" maxLength={80} className="input" />
      <textarea name="body" required rows={5} maxLength={12000} aria-label="Message"
        placeholder={target === "school" ? "Shown on every Primebook in the school" : "Shown on the student's screen"} className="input" />
      <details className="text-sm text-slate-600"><summary className="cursor-pointer">Images and tables</summary>
        <label className="label mt-3">Upload image (up to 3 MB)<input name="image" type="file" accept="image/jpeg,image/png,image/webp" className="input" /></label>
        <label className="label">Or image URL<input name="image_url" type="url" placeholder="https://…" className="input" /></label>
        <p className="my-2 text-xs">Uploaded images are private to your school. Use # for a heading. Create table rows using pipes, for example:</p>
        <pre className="rounded-lg bg-slate-50 p-3 text-xs">{"| Subject | Time |\n| Maths | 09:00 |\n| English | 10:00 |"}</pre>
      </details>
      <label className="flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-sm"><input type="checkbox" name="require_ack" className="mt-1" /><span><strong>Acknowledgement required</strong><br />Keeps the notice on screen until the student selects “I acknowledge”. Requires agent 0.2.0 or later.</span></label>
      <div className="flex items-center gap-3">
        <SubmitButton pending="Sending…">{target === "school" ? "Send to all devices" : "Send"}</SubmitButton>
        {collapsible && <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Close</button>}
        <FormMessage state={state} />
      </div>
    </form>
  );
}
