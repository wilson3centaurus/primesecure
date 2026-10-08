import { signOut } from "@/app/login/actions";

export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm space-y-4 p-6">
        <h1 className="text-lg font-semibold">No dashboard access</h1>
        <p className="text-sm text-slate-600">
          This account isn&apos;t set up as school staff. Ask your school admin or RoboKorda to add you.
        </p>
        <form action={signOut}>
          <button className="btn-secondary">Sign out</button>
        </form>
      </div>
    </main>
  );
}
