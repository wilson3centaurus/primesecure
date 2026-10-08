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
      <textarea name="body" required rows={3} maxLength={1000} aria-label="Message"
        placeholder={target === "school" ? "Shown on every Primebook in the school" : "Shown on the student's screen"} className="input" />
      <div className="flex items-center gap-3">
        <SubmitButton pending="Sending…">{target === "school" ? "Send to all devices" : "Send"}</SubmitButton>
        {collapsible && <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Close</button>}
        <FormMessage state={state} />
      </div>
    </form>
  );
}
