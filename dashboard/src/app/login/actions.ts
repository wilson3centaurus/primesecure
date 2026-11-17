"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/types";
import { signInErrorMessage } from "@/lib/sign-in-error";

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Never log credentials, email addresses, tokens, or raw error payloads.
      console.warn("Sign-in failed", {
        status: error.status,
        invalidCredentials: error.code === "invalid_credentials",
      });
      return { error: signInErrorMessage(error) };
    }
  } catch {
    console.error("Sign-in service request failed");
    return { error: signInErrorMessage({}) };
  }
  redirect("/overview");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
