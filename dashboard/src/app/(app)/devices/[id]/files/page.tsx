import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canManage, requireStaff } from "@/lib/auth";
import { deviceLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { FileBrowser } from "./file-browser";

export const metadata: Metadata = { title: "Device files" };

export default async function DeviceFilesPage({ params }: PageProps<"/devices/[id]/files">) {
  const { id } = await params;
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: device } = await supabase
    .from("devices").select("id, school_id, student_name, model, serial, status").eq("id", id).maybeSingle();
  if (!device) notFound();
  if (!canManage(staff, device.school_id)) redirect(`/devices/${id}`);

  return (
    <>
      <Link href={`/devices/${device.id}`} className="text-sm text-slate-500 hover:underline">← {deviceLabel(device)}</Link>
      <h1 className="mt-2 text-2xl font-semibold">Files</h1>
      <p className="mt-1 mb-6 text-sm text-slate-500">
        The Primebook&apos;s shared storage. Every action is a command, so the device has to be online.
      </p>
      <FileBrowser deviceId={device.id} schoolId={device.school_id} />
    </>
  );
}
