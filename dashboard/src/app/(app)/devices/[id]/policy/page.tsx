import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PolicyEditor } from "@/components/policy-editor";
import { canManage, requireStaff } from "@/lib/auth";
import { deviceLabel } from "@/lib/format";
import { getPolicy } from "@/lib/policy";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Device policy" };

export default async function DevicePolicyPage({ params }: PageProps<"/devices/[id]/policy">) {
  const { id } = await params;
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: device } = await supabase.from("devices").select("id, school_id, student_name, model, serial").eq("id", id).maybeSingle();
  if (!device) notFound();

  const own = await getPolicy(device.school_id, device.id);
  // A new override starts from the school policy so admins tweak rather than retype.
  const start = own ?? (await getPolicy(device.school_id, null));

  return (
    <>
      <Link href={`/devices/${device.id}`} className="text-sm text-slate-500 hover:underline">← {deviceLabel(device)}</Link>
      <h1 className="mt-2 text-2xl font-semibold">Device policy</h1>
      <p className="mt-1 mb-6 text-sm text-slate-500">
        {own
          ? "This device has its own policy, which replaces the school policy entirely."
          : "This device follows the school policy. Saving here gives it its own policy instead (starting from the school's settings below)."}
      </p>
      <PolicyEditor key={own?.id ?? "new"} policy={own ? own : start && { ...start, id: "" }} schoolId={device.school_id}
        deviceId={device.id} canEdit={canManage(staff, device.school_id)} />
    </>
  );
}
