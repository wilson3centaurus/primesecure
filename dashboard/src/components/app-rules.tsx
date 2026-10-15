"use client";
import { useActionState } from "react";
import Link from "next/link";
import { saveAppRules } from "@/app/(app)/settings/actions";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";
export function AppRules({strict,approvedCount}:{strict:boolean;approvedCount:number}) {
 const [state,action]=useActionState(saveAppRules,undefined);
 return <section className="max-w-3xl"><h1 className="mb-2 text-2xl font-semibold">App rules</h1><p className="mb-6 text-sm text-slate-500">The App Store is the source of approval. No package lists to maintain.</p><form action={action} className="card space-y-5 p-5"><label className="flex items-start gap-3"><input name="approved_apps_only" type="checkbox" defaultChecked={strict} className="mt-1 accent-brand-600"/><span><b className="text-sm">Allow only school-approved apps</b><span className="mt-1 block text-sm text-slate-500">Block and hide other student-installed apps. PrimeSecure and firmware apps remain available to protect PrimeOS boot and login. This includes Settings and the vendor store when installed as system apps.</span></span></label><div className="rounded-lg bg-slate-50 p-4 text-sm"><b>{approvedCount} approved apps</b><p className="mt-1 text-xs text-slate-500">An app must be published and enabled for this school. Changes queue an immediate sync request. Check each device’s School sync panel for confirmation. Existing app data is retained.</p><Link className="mt-2 inline-block text-brand-700 underline" href="/apps">Manage App Store</Link></div><p className="text-xs text-slate-500">PrimeSecure 0.6.8 adds prompt sync and acknowledgements. Firmware apps remain protected after the earlier PrimeOS login issue. Disable this rule temporarily for administrator troubleshooting.</p><div className="flex items-center gap-3"><SubmitButton>Save app rule</SubmitButton><FormMessage state={state}/></div></form></section>;
}
