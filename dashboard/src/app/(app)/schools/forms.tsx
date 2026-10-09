"use client";

import { useActionState } from "react";
import { createSchool, renameSchool } from "./actions";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";

export function CreateSchoolForm() {
  const [state, action] = useActionState(createSchool, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-64 flex-1">
        <label htmlFor="new-school" className="label">New school</label>
        <input id="new-school" name="name" required className="input" placeholder="e.g. Rusununguko ZIMFEP High School" />
      </div>
      <SubmitButton pending="Adding…">Add school</SubmitButton>
      <div className="w-full"><FormMessage state={state} /></div>
    </form>
  );
}

export function RenameSchoolForm({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState(renameSchool, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input name="name" defaultValue={name} required aria-label="School name" className="input max-w-md flex-1" />
      <SubmitButton className="btn-secondary">Rename</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
