"use client";

import { useActionState } from "react";
import { signIn } from "./actions";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";

export function LoginForm() {
  const [state, action] = useActionState(signIn, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="input" />
      </div>
      <div>
        <label htmlFor="password" className="label">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      <FormMessage state={state} />
      <SubmitButton className="btn-primary w-full" pending="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
