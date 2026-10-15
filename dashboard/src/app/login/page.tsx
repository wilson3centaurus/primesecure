import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import Image from "next/image";
import { ShieldCheck } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="fixed top-5 right-5"><ThemeToggle/></div>
      <div className="w-full max-w-sm"><div className="mb-6 flex items-center justify-center gap-2.5"><Image unoptimized src="/brand/primebook.png" alt="Primebook" width={32} height={32}/><span className="text-xl font-bold tracking-tight">PrimeSecure<span className="text-brand-500">.</span></span></div><div className="card p-7">
        <span className="mb-4 inline-flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><ShieldCheck size={21}/></span><h1 className="text-lg font-semibold tracking-tight">Welcome to your workspace</h1>
        <p className="mt-2 mb-5 text-xs leading-5 text-muted">Sign in to manage your school&apos;s Primebooks, learning resources and conversations.</p>
        <LoginForm />
      </div><p className="mt-5 text-center text-[11px] text-muted">School technology, managed by RoboKorda.</p></div>
    </main>
  );
}
