import { createClient } from "@/lib/supabase/browser";

// Uploads a file for push_file to media/<school_id>/<uuid>/<name>; returns its storage path.
export async function uploadMedia(schoolId: string, file: File): Promise<{ path?: string; error?: string }> {
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
  const path = `${schoolId}/${crypto.randomUUID()}/${safeName}`;
  const { error } = await createClient().storage.from("media").upload(path, file, {
    contentType: file.type || "application/octet-stream",
  });
  return error ? { error: error.message } : { path };
}
