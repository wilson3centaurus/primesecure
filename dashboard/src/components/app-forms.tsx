"use client";

import { useActionState } from "react";
import { deleteApp, installApp, removeApp } from "@/app/(app)/apps/actions";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import type { App } from "@/lib/types";

export function InstallOnAllButton({ appId, name }: { appId: string; name: string }) {
  const [state, action] = useActionState(installApp, undefined);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="app_id" value={appId} />
      <input type="hidden" name="target" value="school" />
      <SubmitButton className="btn-secondary py-1.5" pending="Queuing…" confirm={`Install ${name} on every enrolled device?`}>
        Install on all devices
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function DeleteAppButton({ id }: { id: string }) {
  const [state, action] = useActionState(deleteApp, undefined);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <SubmitButton className="text-sm text-red-600 underline" pending="…" confirm="Delete this APK from the library?">Delete</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function InstallOnDeviceForm({ deviceId, apps }: { deviceId: string; apps: App[] }) {
  const [state, action] = useActionState(installApp, undefined);
  if (apps.length === 0) return <p className="text-sm text-slate-500">Upload APKs on the Apps page to install them here.</p>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="target" value={deviceId} />
      <select name="app_id" aria-label="App to install" className="input w-auto">
        {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <SubmitButton className="btn-secondary" pending="Queuing…">Install</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function RemoveAppButton({ deviceId, pkg, label }: { deviceId: string; pkg: string; label: string }) {
  const [state, action] = useActionState(removeApp, undefined);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="device_id" value={deviceId} />
      <input type="hidden" name="package" value={pkg} />
      <FormMessage state={state} />
      <SubmitButton className="text-xs text-red-600 underline" pending="…" confirm={`Uninstall ${label} from this device?`}>Remove</SubmitButton>
    </form>
  );
}
