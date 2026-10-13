import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { PushToSchool } from "./push-to-school";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Laptop, FolderOpen } from "lucide-react";
import { dateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Files" };

export default async function FilesPage() {
  const staff = await requireStaff();
  const school = await getCurrentSchool();
  if (!school) return <PageHeader title="Files" description="Add a school first." />;
  if (!canManage(staff, school.id)) redirect("/devices");
  const db=await createClient();const {data:devices}=await db.from('devices').select('id,student_name,student_id,form_level,class_name,status').eq('school_id',school.id).order('student_name');
  const {data:caches}=await db.from('device_file_cache').select('device_id,scanned_at');const scans=new Map((caches||[]).map(c=>[c.device_id,c.scanned_at]));

  return (
    <>
      <PageHeader title="Files"
        description="Browse cached device inventories, even while Primebooks are offline." />
      <div className="mb-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{(devices||[]).map(d=><Link href={`/devices/${d.id}/files`} key={d.id} className="card p-6 transition hover:-translate-y-1"><div className="mb-4 flex items-center justify-between"><span className="rounded-2xl bg-blue-50 p-3 text-blue-500"><Laptop size={25}/></span><FolderOpen size={18} className="text-slate-300"/></div><h2 className="font-semibold">{d.student_name||'Student'}</h2><p className="mt-2 text-xs text-slate-400">{[d.student_id,d.form_level,d.class_name].filter(Boolean).join(' · ')}</p><p className="mt-5 text-xs text-slate-400">Inventory: {scans.get(d.id)?dateTime(scans.get(d.id)!):'Waiting for agent sync'}</p></Link>)}</div>
      <details className="card p-5"><summary className="cursor-pointer font-semibold text-brand-700">Push a file to all devices</summary><div className="pt-5"><PushToSchool schoolId={school.id} /></div></details>
    </>
  );
}
