import type { Device } from "@/lib/types";

// The agent checks in every 15 minutes; allow one missed beat plus slack.
export const ONLINE_WINDOW_MS = 20 * 60 * 1000;

export function isOnline(d: Pick<Device, "last_seen_at">, now = Date.now()) {
  return !!d.last_seen_at && now - new Date(d.last_seen_at).getTime() < ONLINE_WINDOW_MS;
}

export function timeAgo(iso: string | null, now = Date.now()) {
  if (!iso) return "never";
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function dateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Harare" });
}

export function deviceLabel(d: Pick<Device, "student_name" | "model" | "serial">) {
  return d.student_name || d.model || d.serial || "Unnamed device";
}
