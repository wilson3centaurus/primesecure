"use client";
import {useActionState} from "react";
import {setAppDefault} from "@/app/(app)/apps/default-actions";
import {SubmitButton} from "./submit-button";
import {FormMessage} from "./form-message";
export function AppDefault({id,preinstall,available}:{id:string;preinstall:boolean;available:boolean}){
 const [state,action]=useActionState(setAppDefault,undefined);
 return <form action={action} className="mt-2"><input type="hidden" name="id" value={id}/><input type="hidden" name="preinstall" value={preinstall?'false':'true'}/><SubmitButton className="btn-secondary" disabled={!available&&!preinstall}>{preinstall?'Make optional':'Install on all by default'}</SubmitButton><FormMessage state={state}/>{!available&&!preinstall&&<p className="mt-1 text-[10px] text-muted">Enable this app first.</p>}</form>;
}
