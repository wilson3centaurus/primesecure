import { signOut } from "@/app/login/actions";
import { NavLink } from "@/components/nav-link";
import { SchoolSwitcher } from "@/components/school-switcher";
import { getCurrentSchool, getVisibleSchools, requireStaff, ROLE_LABEL } from "@/lib/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const staff = await requireStaff();
  const [schools, school] = await Promise.all([getVisibleSchools(), getCurrentSchool()]);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex flex-col gap-6 bg-slate-900 p-4 text-white md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0">
        <div className="text-lg font-semibold">PrimeSecure</div>

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
          <NavLink href="/policy">School policy</NavLink>
          <NavLink href="/staff">Staff</NavLink>
          {staff.role === "super_admin" && <NavLink href="/schools">Schools</NavLink>}
        </nav>

        <div className="mt-auto border-t border-slate-800 pt-4 text-sm">
          <div className="truncate">{staff.fullName || staff.email}</div>
          <div className="mb-2 text-xs text-slate-400">{ROLE_LABEL[staff.role]}</div>
          <form action={signOut}>
            <button className="text-xs text-slate-300 underline hover:text-white">Sign out</button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
