import { signOut } from "@/app/login/actions";
import { NavLink } from "@/components/nav-link";
import { SchoolSwitcher } from "@/components/school-switcher";
import { getCurrentSchool, getVisibleSchools, requireStaff, ROLE_LABEL } from "@/lib/auth";
import Image from "next/image";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const staff = await requireStaff();
  const [schools, school] = await Promise.all([getVisibleSchools(), getCurrentSchool()]);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="app-sidebar flex flex-col gap-6 p-5 text-white md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:overflow-y-auto">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-white p-2"><Image src="/brand/primebook.png" alt="Primebook" width={32} height={32} /></div><div><div className="text-xl font-semibold tracking-tight">PrimeSecure</div><div className="text-xs text-indigo-200">Connected learning. In control.</div></div></div>

        {staff.role === "super_admin" ? (
          <SchoolSwitcher schools={schools} currentId={school?.id ?? null} />
        ) : (
          <div>
            <div className="text-xs font-medium tracking-wide text-slate-400 uppercase">School</div>
            <div className="text-sm">{school?.name ?? "—"}</div>
          </div>
        )}

        <nav className="flex flex-row flex-wrap gap-1 md:flex-col">
          <NavLink href="/devices">Devices</NavLink>
          <NavLink href="/messages">Messages</NavLink>
          <NavLink href="/library">School Notes</NavLink>
          <NavLink href="/apps">Approved Apps</NavLink>
          <NavLink href="/requests">App requests</NavLink>
          <NavLink href="/wallpapers">Wallpapers</NavLink>
          {staff.role !== "teacher" && <NavLink href="/files">Files</NavLink>}
          <NavLink href="/policy">School policy</NavLink>
          <NavLink href="/staff">Staff</NavLink>
          {staff.role === "super_admin" && <NavLink href="/schools">Schools</NavLink>}
          {staff.role === "super_admin" && <NavLink href="/agent">Agent updates</NavLink>}
        </nav>

        <div className="mt-auto border-t border-slate-800 pt-4 text-sm">
          <div className="mb-4 flex items-center gap-3"><Image src="/brand/robokorda.jpg" alt="RoboKorda" width={58} height={58} className="rounded-lg bg-white" /><span className="text-xs text-indigo-200">Managed by<br /><strong className="text-white">RoboKorda</strong></span></div>
          <div className="truncate">{staff.fullName || staff.email}</div>
          <div className="mb-2 text-xs text-slate-400">{ROLE_LABEL[staff.role]}</div>
          <form action={signOut}>
            <button className="text-xs text-slate-300 underline hover:text-white">Sign out</button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1"><header className="flex items-center justify-between border-b border-slate-200/70 bg-white/80 px-5 py-4 md:px-9"><span className="text-xs font-semibold tracking-widest text-slate-400 uppercase">School workspace</span><span className="text-sm font-medium text-slate-600">{school?.name || "RoboKorda"}</span></header><div className="mx-auto max-w-screen-2xl p-5 md:p-9">{children}</div></main>
    </div>
  );
}
