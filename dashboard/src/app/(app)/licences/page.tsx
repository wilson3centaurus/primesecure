import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { setDeviceLicence } from "./actions";

export const metadata: Metadata = { title: "Licences" };

export default async function LicencesPage({ searchParams }: PageProps<"/licences">) {
  const staff = await requireStaff();
  const school = await getCurrentSchool();
  if (!school || !canManage(staff, school.id)) redirect("/overview");
  const sp = await searchParams;
  const db = await createClient();
  const [{ data: devices, error }, config] = await Promise.all([
    db.from("devices").select("id,student_name,student_id,serial,prime_id,status,licence_state,licence_changed_at").eq("school_id", school.id).order("student_name", { ascending: true, nullsFirst: false }),
    staff.role === "super_admin" ? db.rpc("staff_licence_configuration") : Promise.resolve({ data: null, error: null }),
  ]);
  const validationEnabled = Boolean(config.data?.validation_enabled);
  return <>
    <PageHeader title="PrimeBook licences" description="RoboKorda licence state is independent from student-management lock, suspension and lost mode." />
    {!validationEnabled && <p className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>Validation is off.</strong> Every PrimeBook is treated as licence-good while OS and MDM testing continues. Configured Good/Expired states are saved but not enforced.</p>}
    {typeof sp.notice === "string" && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{sp.notice}</p>}
    {typeof sp.error === "string" && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{sp.error}</p>}
    {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">Licence records could not be loaded.</p>}
    <div className="card overflow-x-auto"><table className="w-full min-w-[900px] text-sm">
      <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Student</th><th className="px-4 py-3">RoboKorda Prime ID</th><th className="px-4 py-3">MDM status</th><th className="px-4 py-3">Configured licence</th><th className="px-4 py-3">Action</th></tr></thead>
      <tbody className="divide-y divide-slate-100">{(devices ?? []).map(device => <tr key={device.id}>
        <td className="px-4 py-3"><div className="font-semibold text-slate-900">{device.student_name || "Unassigned PrimeBook"}</div><div className="text-xs text-slate-500">{device.student_id || "No student number"}</div></td>
        <td className="px-4 py-3 font-mono text-xs">{device.prime_id || device.serial || "Serial pending"}</td>
        <td className="px-4 py-3 capitalize text-slate-600">{device.status}</td>
        <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${device.licence_state === "expired" ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>{device.licence_state === "expired" ? "Expired" : "Good"}</span>{device.licence_changed_at && <div className="mt-1 text-xs text-slate-400">Changed {new Date(device.licence_changed_at).toLocaleString()}</div>}</td>
        <td className="px-4 py-3"><form action={setDeviceLicence}><input type="hidden" name="device_id" value={device.id}/><input type="hidden" name="state" value={device.licence_state === "expired" ? "good" : "expired"}/><button className={device.licence_state === "expired" ? "btn-primary" : "btn-secondary"}>{device.licence_state === "expired" ? "Mark good" : "Mark expired"}</button></form></td>
      </tr>)}{!error && (devices ?? []).length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">No PrimeBooks in this school.</td></tr>}</tbody>
    </table></div>
  </>;
}
