"use client";
import { useActionState } from "react";
import { setPrimeId } from "@/app/(app)/devices/school-controls-actions";
import { SubmitButton } from "./submit-button";
import { FormMessage } from "./form-message";
export function PrimeIdForm({deviceId,value}:{deviceId:string;value:string}) {
 const [state,action]=useActionState(setPrimeId,undefined);
 return <details className="mt-3 text-sm"><summary className="cursor-pointer text-slate-500">Verify or correct the Prime ID</summary><form action={action} className="mt-3 space-y-3"><input type="hidden" name="device_id" value={deviceId}/><label className="label">Hardware Prime ID<input name="prime_id" className="input mt-1 font-mono" defaultValue={value} required placeholder="78:C8:24:B5:8E:12" pattern="([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}"/></label><p className="text-xs text-slate-500">Use the verified identifier on the Primebook. The internal database UUID is a different identifier.</p><SubmitButton className="btn-secondary">Save Prime ID</SubmitButton><FormMessage state={state}/></form></details>;
}
