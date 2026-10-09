"use client";

import { useActionState } from "react";
import { setDeviceStatus } from "../actions";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import type { DeviceStatus } from "@/lib/types";

function StatusButton({ id, status, label, className, confirm }: { id: string; status: DeviceStatus; label: string; className: string; confirm?: string }) {
  const [state, action] = useActionState(setDeviceStatus, undefined);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton className={className} confirm={confirm} pending="…">{label}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

function LockForm({ id, message }: { id: string; message: string | null }) {
  const [state, action] = useActionState(setDeviceStatus, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value="locked" />
      <input name="status_message" defaultValue={message ?? ""} maxLength={500} className="input"
        placeholder="Lock screen message, e.g. Bring this Primebook to the IT office" aria-label="Lock screen message" />
      <div className="flex items-center gap-3">
        <SubmitButton className="btn-danger" pending="Locking…">Lock device</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function StateControls({ id, status, message }: { id: string; status: DeviceStatus; message: string | null }) {
  if (status === "pending") return <p className="text-sm text-slate-500">Available once the device is enrolled.</p>;
  if (status === "retired") return <p className="text-sm text-slate-500">Retired: restrictions removed and Device Owner released. Delete it, or re-provision the Primebook to use it again.</p>;

  return (
    <div className="space-y-4">
      {status === "locked" ? (
        <div className="space-y-2">
          <p className="text-sm">Locked{message ? <>: <span className="italic">&ldquo;{message}&rdquo;</span></> : "."}</p>
          <div className="flex flex-wrap gap-2">
            <StatusButton id={id} status="active" label="Unlock" className="btn-primary" />
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-500">Change lock message</summary>
            <div className="mt-2"><LockForm id={id} message={message} /></div>
          </details>
        </div>
      ) : (
        <>
          <div>
            <p className="mb-2 text-sm text-slate-600">
              <strong>Lock</strong>: full-screen lock the student can&apos;t get past. Use for lost or misused devices.
            </p>
            <LockForm id={id} message={message} />
          </div>
          <div className="flex flex-wrap items-start gap-3 border-t border-slate-100 pt-4">
            {status === "suspended" ? (
              <StatusButton id={id} status="active" label="End suspension" className="btn-primary" />
            ) : (
              <StatusButton id={id} status="suspended" label="Suspend" className="btn-secondary" />
            )}
            <p className="max-w-sm text-xs text-slate-500">
              <strong>Suspend</strong>: only the policy&apos;s allowed apps stay usable (none if that list is empty); Settings is hidden.
            </p>
          </div>
        </>
      )}
      <div className="border-t border-slate-100 pt-4">
        <StatusButton id={id} status="retired" label="Retire device" className="btn-secondary text-red-600"
          confirm="Retire this device? PrimeSecure removes every restriction and gives up Device Owner. You can't manage it again without re-provisioning over adb." />
      </div>
    </div>
  );
}
