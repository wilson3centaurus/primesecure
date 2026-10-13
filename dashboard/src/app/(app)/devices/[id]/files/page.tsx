import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canManage, requireStaff } from "@/lib/auth";
import { deviceLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { LiveFileTools } from "./file-browser";
import { CachedFiles, type FileSnapshot } from "@/components/cached-files";

export const metadata: Metadata = { title: "Device files" };

export default async function DeviceFilesPage({ params }: PageProps<"/devices/[id]/files">) {
  const { id } = await params;
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: device } = await supabase
    .from("devices").select("id, school_id, student_name, model, serial, status").eq("id", id).maybeSingle();
  if (!device) notFound();
  if (!canManage(staff, device.school_id)) redirect(`/devices/${id}`);
  const {data:cache}=await supabase.from('device_file_cache').select('snapshot,scanned_at').eq('device_id',id).maybeSingle();

  return (
    <>
      <Link href={`/devices/${device.id}`} className="text-sm text-slate-500 hover:underline">← {deviceLabel(device)}</Link>
      <h1 className="mt-2 text-2xl font-semibold">Files</h1>
      <p className="mt-1 mb-6 text-sm text-slate-500">
        Browse the last synced inventory while the Primebook is offline. Changes and original-file actions need an online device.
      </p>
      <CachedFiles snapshot={cache?.snapshot as FileSnapshot|null} scannedAt={cache?.scanned_at||null}/>
      <LiveFileTools deviceId={device.id} schoolId={device.school_id}/>
    </>
  );
}
