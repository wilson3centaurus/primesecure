"use client";

import { useActionState, useId } from "react";
import { requestRemoteControl } from "@/app/(app)/devices/remote-control-actions";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";

export function RemoteControls({ deviceId, caseId }: { deviceId: string; caseId?: string }) {
  const [state, action] = useActionState(requestRemoteControl, undefined);
  const prefix = useId();
  return <section className="card space-y-3 border-amber-200 p-5" aria-labelledby={`${prefix}-title`}>
    <h2 id={`${prefix}-title`} className="font-semibold">Visible, authorized remote controls</h2>
    <p className="text-xs leading-5 text-slate-500">A new native agent build is required. Connected devices receive requests immediately when possible; offline requests expire. Requests are audited. No hidden camera, microphone, live stream or tracking account.</p>
    <form action={action} className="space-y-3">
      <input type="hidden" name="device_id" value={deviceId} />
      {caseId && <input type="hidden" name="case_id" value={caseId} />}
      <label className="label block" htmlFor={`${prefix}-reason`}>Reason for this request
        <input id={`${prefix}-reason`} name="reason" required minLength={5} maxLength={500} className="input mt-1" placeholder="For example: locate a misplaced school Primebook" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="label">Action<select className="input mt-1" name="type" defaultValue="alarm"><option value="alarm">Audible high-alert alarm</option><option value="request_capture">Ask student to share an image</option></select></label>
        <label className="label">Alarm duration<select className="input mt-1" name="seconds" defaultValue="15"><option value="5">5 seconds</option><option value="15">15 seconds</option><option value="30">30 seconds (maximum)</option></select></label>
      </div>
      <label className="label block">Image request type<select className="input mt-1" name="kind" defaultValue="screenshot"><option value="screenshot">One screenshot (Android screen-sharing consent)</option><option value="photo">One camera photo (front camera preferred)</option></select></label>
      <p className="text-xs leading-5 text-slate-500">An alarm has an on-device Stop button and restores the previous alarm volume when it ends. Image requests show a notice, require the student’s choice and preview approval, and respect Android protected screens. Images expire after 7 days. Automatic event screenshots are not enabled.</p>
      <label className="flex items-start gap-2 text-xs leading-5"><input className="mt-1" type="checkbox" name="authorized" required />I confirm documented school/guardian authorization and that this request is necessary and appropriate.</label>
      <SubmitButton confirm="Send this visible, audited request to the student's Primebook? Capture still requires on-device consent." pending="Sending request…">Send visible request</SubmitButton>
      <FormMessage state={state} />
    </form>
  </section>;
}
