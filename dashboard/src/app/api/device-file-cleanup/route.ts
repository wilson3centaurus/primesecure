import { timingSafeEqual } from "node:crypto";
import { cleanExpiredDeviceOriginals } from "@/lib/device-original-cleanup";

export const runtime = "nodejs";

// Invoke hourly (or at least daily) with Authorization: Bearer $CRON_SECRET.
// Never accepts a staff browser token or a device JWT as maintenance authority.
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 32) return Response.json({ error: "Cleanup scheduler is not configured." }, { status: 503 });
  const actual = request.headers.get("authorization") ?? "";
  const token = `Bearer ${expected}`;
  if (Buffer.byteLength(actual) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(actual), Buffer.from(token)))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await cleanExpiredDeviceOriginals(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Original cleanup failed. Check storage health and retry." }, { status: 500 });
  }
}
