"use server";

import { revalidatePath } from "next/cache";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CommandStatus, CommandType } from "@/lib/types";

type Result = { error?: string; commandId?: string; count?: number };

// Destination paths are relative to the device's shared storage (/sdcard).
function cleanPath(raw: string): string | null {
  const parts = raw.replace(/\\/g, "/").split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.some((p) => p === "." || p === "..")) return null;
  return parts.join("/");
}

async function managedDevice(deviceId: string) {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: device } = await supabase.from("devices").select("id, school_id").eq("id", deviceId).maybeSingle();
  if (!device || !canManage(staff, device.school_id)) return null;
  return { staff, supabase, device };
}

async function queue(deviceId: string, type: CommandType, payload: Record<string, unknown>): Promise<Result> {
  const ctx = await managedDevice(deviceId);
  if (!ctx) return { error: "Only school admins can manage files." };
  const { data, error } = await ctx.supabase
    .from("commands")
    .insert({ device_id: deviceId, type, payload, created_by: ctx.staff.id })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { commandId: data.id };
}

export async function listFiles(deviceId: string, path: string): Promise<Result> {
  const clean = cleanPath(path);
  if (clean === null) return { error: "Invalid folder." };
  return queue(deviceId, "list_files", { path: clean });
}

export async function deleteFile(deviceId: string, path: string, recursive: boolean): Promise<Result> {
  const clean = cleanPath(path);
  if (!clean) return { error: "Invalid path." };
  return queue(deviceId, "delete_file", { path: clean, recursive });
}

// storagePath: an object the browser already uploaded to media/<school_id>/...
export async function pushFile(target: string, storagePath: string, destination: string): Promise<Result> {
  const dest = cleanPath(destination);
  if (!dest) return { error: "Enter where to save the file on the device." };

  const staff = await requireStaff();
  const supabase = await createClient();
  let devices: { id: string; school_id: string }[];
  if (target === "school") {
    const school = await getCurrentSchool();
    if (!school || !canManage(staff, school.id)) return { error: "Only school admins can push files." };
    const { data } = await supabase.from("devices").select("id, school_id").eq("school_id", school.id)
      .in("status", ["active", "suspended", "locked"]);
    devices = data ?? [];
  } else {
    const ctx = await managedDevice(target);
    if (!ctx) return { error: "Only school admins can push files." };
    devices = [ctx.device];
  }
  if (devices.length === 0) return { error: "No enrolled devices." };
  if (!storagePath.startsWith(`${devices[0].school_id}/`)) return { error: "Upload the file again." };

  const { data, error } = await supabase
    .from("commands")
    .insert(devices.map((d) => ({ device_id: d.id, type: "push_file", payload: { storage_path: storagePath, path: dest }, created_by: staff.id })))
    .select("id");
  if (error) return { error: error.message };
  revalidatePath("/devices", "layout");
  return { commandId: data[0]?.id, count: data.length };
}

export async function getCommand(id: string): Promise<{ status: CommandStatus; result: Record<string, unknown> | null } | null> {
  await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase.from("commands").select("status, result").eq("id", id).maybeSingle();
  return data as { status: CommandStatus; result: Record<string, unknown> | null } | null;
}

// Never sends an original through a Next.js action. This queues an audited
// device upload; small status responses yield a short-lived, attachment-only URL.
export async function requestOriginalFile(deviceId: string, path: string, size: number, modified: number): Promise<{ requestId?: string; error?: string }> {
  if (!Number.isSafeInteger(size) || size < 0 || size > 500_000_000 || !Number.isSafeInteger(modified) || modified < 0)
    return { error: "Invalid file metadata or file larger than 500 MB." };
  const clean = cleanPath(path);
  if (!clean || clean !== path) return { error: "Invalid shared-storage path." };
  const ctx = await managedDevice(deviceId);
  if (!ctx) return { error: "Only school admins can request originals." };
  const { data, error } = await ctx.supabase.rpc("request_device_file", {
    p_device_id: deviceId, p_path: path, p_size: size, p_modified: modified,
  });
  if (error || !data?.request_id) return { error: error?.message ?? "Could not queue the original-file request." };
  return { requestId: data.request_id };
}

export type OriginalFileStatus = { status?: string; error?: string; downloadUrl?: string; filename?: string; expiresAt?: string };
export async function getOriginalFile(requestId: string): Promise<OriginalFileStatus> {
  await requireStaff();
  if (!/^[a-f0-9-]{36}$/i.test(requestId)) return { error: "Invalid file request." };
  const supabase = await createClient();
  // RPC checks current manager privileges, device school, expiry, and completion.
  const { data, error } = await supabase.rpc("admin_device_file_transfer", { p_request_id: requestId });
  if (error || !data) return { error: error?.message ?? "File request unavailable." };
  if (data.status !== "ready") return { status: data.status, error: data.error ?? undefined, expiresAt: data.expires_at };
  if (!data.storage_path || Date.parse(data.expires_at) <= Date.now()) return { status: "expired" };
  const seconds = Math.min(60, Math.floor((Date.parse(data.expires_at) - Date.now()) / 1000));
  if (seconds < 1) return { status: "expired" };
  const filename = String(data.filename || "original").replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 255);
  const { data: signed, error: signingError } = await supabase.storage.from("device-file-originals")
    .createSignedUrl(data.storage_path, seconds, { download: filename });
  if (signingError || !signed?.signedUrl) return { error: signingError?.message ?? "Could not create the download link." };
  return { status: "ready", downloadUrl: signed.signedUrl, filename, expiresAt: data.expires_at };
}
