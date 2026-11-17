"use client";

import { useActionState } from "react";
import { issueSchoolSetupCode, type SetupCodeState } from "./actions";

export function SetupCodeForm() {
  const [state, action, pending] = useActionState<SetupCodeState, FormData>(issueSchoolSetupCode, undefined);
  return <div>
    <form action={action}><button className="btn-primary w-full sm:w-auto" disabled={pending}>{pending ? "Issuing code…" : "Generate one-time 6-digit code"}</button></form>
    {state?.error ? <p className="mt-2 max-w-sm text-sm text-red-700" role="alert">{state.error}</p> : null}
    {state?.code ? <section className="mt-3 min-w-80 rounded-2xl border border-brand-200 bg-brand-50 p-4" role="status" aria-live="polite">
      <p className="text-xs font-semibold text-brand-900">PrimeBook setup code</p>
      <p className="mt-1 font-mono text-3xl font-bold tracking-[0.28em] text-brand-700">{state.code}</p>
      <p className="mt-2 text-xs text-brand-800">Use on one PrimeBook within 15 minutes.</p>
    </section> : null}
  </div>;
}
