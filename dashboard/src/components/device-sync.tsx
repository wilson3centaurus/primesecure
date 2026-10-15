"use client";
import { useActionState } from "react";
import { requestDeviceSync } from "@/app/(app)/devices/actions";
import { SubmitButton } from "./submit-button";
import { FormMessage } from "./form-message";

export function DeviceSync({deviceId,requested,applied,requestedLabel,appliedLabel,topics}:{deviceId:string;requested:number;applied:number;requestedLabel:string;appliedLabel:string;topics:string[]}) {
 const [state,action]=useActionState(requestDeviceSync,undefined);
 const pending=requested>applied;
 return <section className="card p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">School sync</h2><span className={`rounded-full px-3 py-1 text-xs ${pending?'bg-amber-50 text-amber-800':'bg-emerald-50 text-emerald-700'}`}>{pending?'Waiting for device':requested>0?'Settings received':'No sync requested'}</span></div>
  <p className="mt-3 text-sm text-slate-600">Requested revision {requested} · received {applied}</p>
  <p className="mt-1 text-xs text-slate-500">Last request: {requestedLabel} · last confirmation: {appliedLabel}</p>
  {topics.length>0&&<p className="mt-1 text-xs text-slate-500">Changes: {topics.join(', ')}</p>}
  <p className="mt-3 text-xs text-slate-500">PrimeSecure 0.6.8 confirms after applying settings and receiving the library list. Books, wallpapers and app downloads continue separately in Background tasks. Delivery depends on connectivity; no restart is needed.</p>
  <form action={action} className="mt-3 flex flex-wrap items-center gap-3"><input type="hidden" name="device_id" value={deviceId}/><SubmitButton className="btn-secondary">Sync now</SubmitButton><FormMessage state={state}/></form>
 </section>;
}
