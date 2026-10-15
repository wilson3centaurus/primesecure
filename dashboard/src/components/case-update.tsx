"use client";

import { useActionState } from "react";
import { createCase, updateCase } from "@/app/(app)/cases/actions";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";

type CaseState = "open" | "observing" | "resolved";

export function CaseUpdate({ id, state, note }: { id: string; state: CaseState; note: string }) {
  const [result, action] = useActionState(updateCase, undefined);
  return <form action={action} className="mt-4 grid gap-3">
    <input type="hidden" name="case_id" value={id} />
    <label className="label">Review state<select name="state" defaultValue={state} className="input mt-1"><option value="open">Open</option><option value="observing">Observing</option><option value="resolved">Resolved</option></select></label>
    <label className="label">Staff notes<textarea name="note" rows={3} maxLength={4000} defaultValue={note} className="input mt-1" placeholder="Record the evidence and next steps." /></label>
    <div className="flex flex-wrap items-center gap-3"><SubmitButton>Save case</SubmitButton><FormMessage state={result} /></div>
  </form>;
}

export function CaseCreate({ devices }: { devices: { id: string; label: string }[] }) {
  const [result, action] = useActionState(createCase, undefined);
  return <form action={action} className="mt-4 grid gap-4">
    <label className="label">Student<select name="device_id" required defaultValue="" className="input mt-1"><option value="" disabled>Choose a student</option>{devices.map(device => <option value={device.id} key={device.id}>{device.label}</option>)}</select></label>
    <label className="label">Case title<input name="title" required maxLength={200} className="input mt-1" placeholder="What needs review?" /></label>
    <label className="label">Staff notes<textarea name="note" rows={3} maxLength={4000} className="input mt-1" placeholder="Add the known facts and the follow-up needed." /></label>
    <div className="flex flex-wrap items-center gap-3"><SubmitButton disabled={!devices.length}>Open case</SubmitButton><FormMessage state={result} /></div>
  </form>;
}
