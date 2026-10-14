"use client";
import { useActionState } from "react";
import { supportReply } from "@/app/(app)/support/actions";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";
export function SupportReply({deviceId}:{deviceId:string}) {
 const [state,action]=useActionState(supportReply,undefined);
 return <form action={action} className="mt-6 space-y-3"><input name="device_id" type="hidden" value={deviceId}/><label className="label">Reply as RoboKorda support<textarea name="body" required maxLength={4000} rows={3} className="input mt-2"/></label><div className="flex gap-4"><SubmitButton>Send reply</SubmitButton><FormMessage state={state}/></div></form>;
}
