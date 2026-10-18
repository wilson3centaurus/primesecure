import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "Referrer-Policy": "no-referrer" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [staff, school, { id }] = await Promise.all([requireStaff(), getCurrentSchool(), params]);
  if (!school || !canManage(staff, school.id)) return new Response("Not available", { status: 404, headers });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not available", { status: 404, headers });
  const db = await createClient();
  const { data, error } = await db.from("remote_capture_frames").select("school_id,image,expires_at").eq("command_id", id).eq("school_id", school.id).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error || !data || !canManage(staff, data.school_id)) return new Response("Image unavailable or expired", { status: 404, headers });
  return new Response(Buffer.from(data.image.substring("data:image/jpeg;base64,".length), "base64"), { headers: { ...headers, "Content-Type": "image/jpeg", "Content-Disposition": 'inline; filename="school-capture.jpg"' } });
}
