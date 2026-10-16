import { signOut } from "@/app/login/actions";
import { NavLink } from "@/components/nav-link";
import { SchoolSwitcher } from "@/components/school-switcher";
import { WorkspaceShell } from "@/components/workspace-shell";
import { UploadQueueProvider } from "@/components/upload-queue";
import { getCurrentSchool, getVisibleSchools, requireStaff, ROLE_LABEL } from "@/lib/auth";
import Image from "next/image";
import { LayoutDashboard, Laptop, Mail, FolderOpen, AppWindow, MessageCircle, Users, School, Download, Settings, BarChart3, ClipboardList, LogOut } from "lucide-react";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const staff = await requireStaff();
  const [schools, school] = await Promise.all([getVisibleSchools(), getCurrentSchool()]);
  const sidebar=<>
    <div className="flex items-center gap-2.5 px-1"><div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50"><Image unoptimized src="/brand/primebook.png" alt="Primebook" width={26} height={26}/></div><div className="sidebar-detail"><div className="text-[16px] font-bold tracking-tight text-ink">PrimeSecure<span className="ml-1 text-brand-500">.</span></div><p className="mt-0.5 text-[10px] font-medium text-muted">RoboKorda management</p></div></div>
    <div className="sidebar-detail rounded-lg border border-line bg-panel p-3">{staff.role==="super_admin"?<SchoolSwitcher schools={schools} currentId={school?.id??null}/>:<><p className="mb-1 text-[10px] font-semibold tracking-wide text-muted uppercase">School workspace</p><p className="text-xs font-medium text-ink">{school?.name??"No school"}</p></>}</div>
    <div className="space-y-2"><p className="sidebar-caption">Workspace</p><nav className="space-y-1" aria-label="School workspace">
      <NavLink href="/overview"><LayoutDashboard/>Overview</NavLink>
      <NavLink href="/devices"><Laptop/>Students & devices</NavLink>
      <NavLink href="/messages"><Mail/>Messages</NavLink>
      <NavLink href="/library"><FolderOpen/>Content & files</NavLink>
      <NavLink href="/apps"><AppWindow/>Apps</NavLink>
      {staff.role!=="teacher"&&<NavLink href="/support"><MessageCircle/>Student support</NavLink>}
    </nav></div>
    <div className="space-y-2"><p className="sidebar-caption">Management</p><nav className="space-y-1" aria-label="School management">
      {staff.role!=="teacher"&&<NavLink href="/reports"><BarChart3/>Usage reports</NavLink>}
      {staff.role!=="teacher"&&<NavLink href="/cases"><ClipboardList/>Issues & cases</NavLink>}
      {staff.role!=="teacher"&&<NavLink href="/settings"><Settings/>Settings</NavLink>}
      <NavLink href="/staff"><Users/>Staff</NavLink>
      {staff.role==="super_admin"&&<NavLink href="/schools"><School/>Schools</NavLink>}
      {staff.role==="super_admin"&&<NavLink href="/agent"><Download/>Agent updates</NavLink>}
    </nav></div>
    <div className="mt-auto border-t border-line pt-4"><div className="mb-4 flex items-center gap-2.5 px-1"><Image unoptimized src="/brand/robokorda.jpg" alt="RoboKorda" width={34} height={34} className="size-9 shrink-0 rounded-lg border border-line bg-white object-contain"/><span className="sidebar-detail text-[10px] leading-4 text-muted">School technology,<br/><strong className="font-semibold text-ink">managed by RoboKorda</strong></span></div><div className="sidebar-detail flex items-center justify-between gap-2 rounded-lg bg-panel px-3 py-2.5"><div className="min-w-0"><p className="truncate text-xs font-semibold text-ink" title={staff.email}>{staff.fullName||staff.email}</p><p className="mt-0.5 text-[10px] text-muted">{ROLE_LABEL[staff.role]}</p></div><form action={signOut}><button className="icon-button" aria-label="Sign out" title="Sign out"><LogOut size={14}/></button></form></div></div>
  </>;
  return <UploadQueueProvider key={staff.id} userId={staff.id} schools={schools}><WorkspaceShell school={school?.name||"RoboKorda"} sidebar={sidebar}>{children}</WorkspaceShell></UploadQueueProvider>;
}
