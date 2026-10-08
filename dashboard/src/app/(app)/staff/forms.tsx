"use client";

import { useActionState, useState } from "react";
import { addStaff, changeRole, removeStaff, resetPassword } from "./actions";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import type { AppRole } from "@/lib/types";

export function AddStaffForm() {
  const [state, action] = useActionState(addStaff, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
      <div>
        <label htmlFor="full_name" className="label">Name</label>
        <input id="full_name" name="full_name" required className="input" />
      </div>
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" name="email" type="email" required className="input" />
      </div>
      <div>
        <label htmlFor="password" className="label">Temporary password</label>
        <input id="password" name="password" type="text" minLength={8} required className="input" autoComplete="off" />
      </div>
      <div>
        <label htmlFor="role" className="label">Role</label>
        <select id="role" name="role" defaultValue="teacher" className="input">
          <option value="teacher">Teacher</option>
          <option value="school_admin">School admin</option>
        </select>
      </div>
      <SubmitButton pending="Adding…">Add staff</SubmitButton>
      <div className="sm:col-span-2 lg:col-span-5"><FormMessage state={state} /></div>
    </form>
  );
}

export function StaffActions({ id, role }: { id: string; role: AppRole }) {
  const [roleState, roleAction] = useActionState(changeRole, undefined);
  const [pwState, pwAction] = useActionState(resetPassword, undefined);
  const [rmState, rmAction] = useActionState(removeStaff, undefined);
  const [showPw, setShowPw] = useState(false);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <form action={roleAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <select name="role" defaultValue={role} aria-label="Role" className="input w-auto py-1.5"
            onChange={(e) => e.currentTarget.form?.requestSubmit()}>
            <option value="teacher">Teacher</option>
            <option value="school_admin">School admin</option>
          </select>
        </form>
        <button type="button" className="btn-secondary py-1.5" onClick={() => setShowPw((v) => !v)}>Reset password</button>
        <form action={rmAction}>
          <input type="hidden" name="id" value={id} />
          <SubmitButton className="btn-secondary py-1.5 text-red-600" pending="Removing…" confirm="Remove this person and delete their login?">
            Remove
          </SubmitButton>
        </form>
      </div>
      {showPw && (
        <form action={pwAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <input name="password" type="text" minLength={8} required placeholder="New password" aria-label="New password" className="input w-48 py-1.5" autoComplete="off" />
          <SubmitButton className="btn-primary py-1.5">Set</SubmitButton>
        </form>
      )}
      <FormMessage state={roleState} />
      <FormMessage state={pwState} />
      <FormMessage state={rmState} />
    </div>
  );
}
