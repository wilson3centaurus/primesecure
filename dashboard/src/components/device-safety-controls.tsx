"use client";
import { useActionState } from "react";
import { ShieldCheck, RotateCcw } from "lucide-react";
import { setDeviceSafety } from "@/app/(app)/devices/actions";
import { SubmitButton } from "./submit-button";
import { FormMessage } from "./form-message";

export type SafetyControl={revision:number;safe_mode:boolean;ui_rollback_revision:number;updates_paused:boolean;recovery_release_id:string|null};
type Report={revision?:number;safe_mode?:boolean;ui_rollback_applied?:number;offline_boot_restore?:boolean};
type Release={id:string;version_code:number;version_name:string};
export function DeviceSafetyControls({deviceId,desired,reported,releases=[],installedCode}:{deviceId:string;desired:SafetyControl|null;reported?:Report;releases?:Release[];installedCode:number|null}) {
 const ack=reported&&Number(reported.revision)>=Number(desired?.revision||0);
 return <section className="card mb-5 space-y-4 p-4" aria-label="Recovery and rollback">
  <div className="flex items-center gap-2"><ShieldCheck size={17}/><h2 className="font-semibold">Recovery & rollback</h2></div>
  <p className="text-xs leading-5 text-muted">Requires agent 0.8.2. Pausing app restrictions restores apps hidden or suspended by PrimeSecure and pauses automatic updates. Files, enrollment and the device password are retained. Lost-device locks stay in force.</p>
  <div className="flex flex-wrap gap-2 text-xs"><span className="rounded-md bg-panel px-2 py-1">App restrictions: {desired?.safe_mode?'pause requested':'school policy'}</span><span className="rounded-md bg-panel px-2 py-1">Updates: {desired?.updates_paused?'paused':'automatic'}</span><span className="rounded-md bg-panel px-2 py-1">{ack?'Device confirmed recovery revision '+reported?.revision:'Waiting for device confirmation'}</span></div>
  <div className="flex flex-wrap gap-2"><SafetyAction deviceId={deviceId} action={desired?.safe_mode?'safe_off':'safe_on'} label={desired?.safe_mode?'Resume app restrictions':'Pause app restrictions'} confirm={desired?.safe_mode?'Reapply the school app policy on this test device?':'Restore apps hidden by PrimeSecure on this device and pause automatic updates?'}/><SafetyAction deviceId={deviceId} action="rollback_ui" label="Roll back interface" confirm="Use the previous saved working interface (or the bundled interface) on next opening, and pause automatic updates?"/>{desired?.updates_paused&&<SafetyAction deviceId={deviceId} action="resume_updates" label="Resume automatic updates" confirm="Allow this device to download current APK and interface releases again?"/>}</div>
  {Number(desired?.ui_rollback_revision)>0&&<p className="text-xs text-muted">Interface rollback: {Number(reported?.ui_rollback_applied)>=Number(desired?.ui_rollback_revision)?'applied; reopen PrimeSecure':'queued for the next unlock / opening'}.</p>}
  <p className="text-xs leading-5 text-muted">Startup protection restores PrimeSecure-hidden apps locally before first unlock, without internet. PrimeOS must still start our boot receiver. Remote buttons need connectivity; Wi-Fi reconnection and recovery from an OS crash cannot be guaranteed. This does not automatically sign the student in.</p>
  {releases.length>0&&<details className="border-t border-line pt-3"><summary className="cursor-pointer text-xs font-medium">Install a prepared recovery APK</summary><p className="my-2 text-xs leading-5 text-muted">To revert native code, rebuild the working source with the same signing key and a higher version code, then upload it under Agent updates and pause its fleet rollout. Only this device receives the selected build. Installation requires an unlocked, connected device.</p><RecoveryApk deviceId={deviceId} releases={releases.filter(r=>installedCode!=null&&r.version_code>installedCode)} installedCode={installedCode}/></details>}
 </section>;
}
function SafetyAction({deviceId,action,label,confirm}:{deviceId:string;action:string;label:string;confirm:string}) {
 const [state,submit]=useActionState(setDeviceSafety,undefined);
 return <form action={submit}><input type="hidden" name="device_id" value={deviceId}/><input type="hidden" name="action" value={action}/><SubmitButton className="btn-secondary text-xs" confirm={confirm}>{action==='rollback_ui'&&<RotateCcw size={13}/>} {label}</SubmitButton><FormMessage state={state}/></form>;
}
function RecoveryApk({deviceId,releases,installedCode}:{deviceId:string;releases:Release[];installedCode:number|null}) {
 const [state,submit]=useActionState(setDeviceSafety,undefined);
 return <form action={submit} className="flex flex-wrap items-end gap-2"><input type="hidden" name="device_id" value={deviceId}/><input type="hidden" name="action" value="install_recovery"/><label className="label flex-1">Recovery build<select name="release_id" required className="input mt-1" defaultValue=""><option value="">{releases.length?'Choose a prepared recovery build':'Upload a build newer than '+(installedCode??'the installed APK')}</option>{releases.map(r=><option key={r.id} value={r.id}>{r.version_name} ({r.version_code})</option>)}</select></label><SubmitButton className="btn-secondary" disabled={!releases.length} confirm="Install this recovery build only on this Primebook? Verify that it contains the intended working source and uses the same signing key.">Install recovery APK</SubmitButton><FormMessage state={state}/></form>;
}
