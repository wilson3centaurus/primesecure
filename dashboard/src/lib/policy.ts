import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Policy } from "@/lib/types";

export async function getPolicy(schoolId: string, deviceId: string | null): Promise<Policy | null> {
  const supabase = await createClient();
  const query = supabase.from("policies").select("*").eq("school_id", schoolId);
  const { data } = await (deviceId ? query.eq("device_id", deviceId) : query.is("device_id", null)).maybeSingle();
  return (data as Policy | null) ?? null;
}
