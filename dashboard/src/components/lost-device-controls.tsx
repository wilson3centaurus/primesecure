"use client";
import { useActionState } from "react";
import { setLost } from "@/app/(app)/devices/school-controls-actions";
import { SubmitButton } from "./submit-button";
import { FormMessage } from "./form-message";
export function LostDeviceControls({deviceId,lost,alarm,message}:{deviceId:string;lost:boolean;alarm:boolean;message:string}) {
 const [state,action]=useActionState(setLost,undefined);
 return <section className={`card p-5 ${lost?'border-amber-300':''}`}><h2 className="font-semibold">Lost-device recovery</h2><p className="mt-2 text-sm text-slate-600">{lost?'Tagged lost. The agent requests a visible lock and more frequent location/Wi-Fi reporting.':'Tag a school-owned Primebook as lost to request its recovery screen, tracking and optional audible alarm.'}</p>
  <p className="mt-2 text-xs text-slate-500">Delivery requires internet and agent 0.7.0. Physical power buttons and recovery flashing cannot be disabled by this APK. Camera access only starts when the student chooses to share a support photo; no silent recording.</p>
  <form action={action} className="mt-4 space-y-3"><input type="hidden" name="device_id" value={deviceId}/><input type="hidden" name="mode" value={lost?'found':'lost'}/>
   {!lost&&<><label className="label">Recovery message<textarea className="input mt-1" name="message" defaultValue={message||'This school Primebook is reported lost. Please return it to the school office.'} maxLength={1000}/></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="alarm" defaultChecked={alarm}/>Request a continuous audible alarm</label></>}
   <label className="flex items-start gap-2 text-xs text-slate-600"><input name="confirm" type="checkbox" className="mt-0.5"/>I confirm this recovery action for this school-owned device.</label>
   <SubmitButton className={lost?'btn-primary':'btn-secondary'}>{lost?'Mark found and stop alarm':'Mark device lost'}</SubmitButton><FormMessage state={state}/>
  </form>{state?.code&&<div className="mt-4 rounded-lg bg-amber-50 p-4 text-sm"><p className="font-semibold">One-time administrator recovery code</p><code className="my-2 block select-all break-all text-xl tracking-widest">{state.code}</code><p className="text-xs">Save it securely. It is verified online from the lost screen; it is not the Android login password. Mark found invalidates it. A new lost request rotates the code.</p></div>}
 </section>;
}
