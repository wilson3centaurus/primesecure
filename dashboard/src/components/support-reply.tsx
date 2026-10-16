"use client";
import { useActionState, useState } from "react";
import { supportReply } from "@/app/(app)/support/actions";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";
import { prepareImage } from "@/lib/image-attachment";
import type { FormState } from "@/lib/types";
import Image from 'next/image';
export function SupportReply({deviceId}:{deviceId:string}) {
 const [image,setImage]=useState(''),[error,setError]=useState(''),[processing,setProcessing]=useState(false),[fileKey,setFileKey]=useState(0);
 const [state,action]=useActionState(async (previous:FormState,form:FormData)=>{const result=await supportReply(previous,form);if(result?.ok){setImage('');setFileKey(k=>k+1);}return result;},undefined);
 return <form action={action} className="mt-5 space-y-3"><input name="device_id" type="hidden" value={deviceId}/><input name="image" type="hidden" value={image}/><label className="label">Reply as RoboKorda support<textarea name="body" required maxLength={4000} rows={3} className="input mt-2"/></label><label className="label">Image (optional)<input key={fileKey} type="file" accept="image/jpeg,image/png,image/webp" className="input mt-1" onChange={async e=>{const file=e.target.files?.[0];setImage('');setError('');if(!file)return;setProcessing(true);try{setImage(await prepareImage(file));}catch(error){setError(error instanceof Error?error.message:'Could not prepare image.');}finally{setProcessing(false);}}}/></label>{image&&<div className="flex items-center gap-3"><Image unoptimized src={image} alt="Image to attach" width={150} height={100} className="max-h-28 w-auto rounded-lg"/><button type="button" className="btn-secondary" onClick={()=>{setImage('');setFileKey(k=>k+1);}}>Remove image</button></div>}{error&&<p role="alert" className="text-xs text-red-600">{error}</p>}<div className="flex gap-4"><SubmitButton disabled={processing||!!error}>{processing?'Preparing image…':'Send reply'}</SubmitButton><FormMessage state={state}/></div></form>;
}
