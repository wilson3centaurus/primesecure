"use client";

import { useActionState } from "react";
import { deleteDevice, issueToken, updateStudent } from "../actions";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";

import { ClassSelect,type SchoolClass } from "@/components/class-select";
export function StudentForm({ id, name, studentId,formLevel,className,gender,groups }: { id: string; name: string | null; studentId: string | null; formLevel:string;className:string;gender:string;groups:SchoolClass[] }) {
  const [state, action] = useActionState(updateStudent, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="student_name" className="label">Student name</label>
          <input id="student_name" name="student_name" defaultValue={name ?? ""} className="input" />
        </div>
        <div>
          <label htmlFor="student_id" className="label">Student ID</label>
          <input id="student_id" name="student_id" defaultValue={studentId ?? ""} className="input" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3"><ClassSelect groups={groups} formLevel={formLevel} className={className}/><label className="label">Gender<select name="gender" defaultValue={gender} className="input mt-1"><option value="">Not specified</option><option>Female</option><option>Male</option><option>Other</option></select></label></div>
      <div className="flex items-center gap-3">
        <SubmitButton className="btn-secondary">Save</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function IssueTokenForm({ id, label }: { id: string; label: string }) {
  const [state, action] = useActionState(issueToken, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <SubmitButton className="btn-secondary" pending="Issuing…">{label}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function DeleteDeviceForm({ id }: { id: string }) {
  const [state, action] = useActionState(deleteDevice, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <SubmitButton className="btn-danger" pending="Deleting…"
        confirm="Delete this device and its history? The Primebook keeps its current restrictions until you re-enroll or reset it.">
        Delete device
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
