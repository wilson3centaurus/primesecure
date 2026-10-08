import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold">PrimeSecure</h1>
        <p className="mb-6 text-sm text-slate-500">Sign in to manage your school&apos;s Primebooks.</p>
        <LoginForm />
      </div>
    </main>
  );
}
