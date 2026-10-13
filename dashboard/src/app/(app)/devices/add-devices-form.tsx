"use client";

import { useActionState, useState } from "react";
import { addDevices } from "./actions";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";

export function AddDevicesForm() {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(addDevices, undefined);

  if (!open) {
    return <button type="button" className="btn-primary" onClick={() => setOpen(true)}>Add devices</button>;
  }

  return (
    <div className="card w-full p-4">
      <form action={action} className="space-y-3">
        <div>
          <label htmlFor="students" className="label">Students, one per line</label>
          <textarea id="students" name="students" rows={5} required className="input font-mono"
            placeholder={"Tendai Moyo, Form 3, 3A, Male\nRutendo Ncube, Form 3, 3B, Female"} />
          <p className="mt-1 text-xs text-slate-500">Name, form, class, gender. Student numbers are generated automatically. You can enter names only and use the defaults below.</p>
        </div>
        <div className="grid grid-cols-3 gap-3"><label className="label">Default form<select name="form_level" className="input"><option value="">Choose form</option>{[1,2,3,4,5,6].map(n=><option key={n}>Form {n}</option>)}</select></label><label className="label">Default class<input name="class_name" className="input" placeholder="3A"/></label><label className="label">Default gender<select name="gender" className="input"><option value="">Not specified</option><option>Female</option><option>Male</option><option>Other</option></select></label></div>
        <div className="flex gap-2">
          <SubmitButton pending="Adding…">Create devices</SubmitButton>
          <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Close</button>
        </div>
        <FormMessage state={state} />
      </form>
      {state?.created && state.created.length > 0 && (
        <table className="mt-4 w-full text-sm">
          <thead><tr className="text-left text-slate-500"><th className="py-1">Student</th><th>Enroll token</th></tr></thead>
          <tbody>
            {state.created.map((d) => (
              <tr key={d.id} className="border-t border-slate-100">
                <td className="py-1">{d.name || "—"}</td>
                <td className="font-mono text-base font-semibold tracking-wider">{d.token}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
