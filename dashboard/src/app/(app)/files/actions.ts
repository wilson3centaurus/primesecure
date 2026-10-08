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
