import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Storage API deletion is essential: deleting storage.objects alone leaves blobs. */
export async function cleanExpiredDeviceOriginals() {
  const db = createAdminClient();
  const now = new Date().toISOString();
  let removed = 0;
  // Bound each scheduled invocation. Rows remain audit records, not original data.
  for (let page = 0; page < 10; page++) {
    const { data, error } = await db.from("device_file_transfers")
      .select("id,storage_path").is("cleaned_at", null).lte("expires_at", now).order("expires_at").limit(100);
    if (error) throw new Error("Could not list expired device originals.");
    if (!data?.length) return { removed, hasMore: false };
    const { error: deletionError } = await db.storage.from("device-file-originals").remove(data.map(row => row.storage_path));
    if (deletionError) throw new Error("Expired originals could not be deleted; cleanup will retry.");
    const { error: markError } = await db.from("device_file_transfers").update({ cleaned_at: now }).in("id", data.map(row => row.id));
    if (markError) throw new Error("Cleanup succeeded but its audit markers need retry.");
    removed += data.length;
    if (data.length < 100) return { removed, hasMore: false };
  }
  return { removed, hasMore: true };
}
