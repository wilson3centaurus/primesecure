import { isOnline, timeAgo } from "@/lib/format";
import type { Device, DeviceStatus } from "@/lib/types";

const STATUS_STYLE: Record<DeviceStatus, string> = {
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  active: "bg-green-50 text-green-700 ring-green-200",
  suspended: "bg-orange-50 text-orange-700 ring-orange-200",
  locked: "bg-red-50 text-red-700 ring-red-200",
  retired: "bg-slate-100 text-slate-600 ring-slate-200",
};

const STATUS_LABEL: Record<DeviceStatus, string> = {
  pending: "Not enrolled",
  active: "Active",
  suspended: "Suspended",
  locked: "Locked",
  retired: "Retired",
};

export function StatusBadge({ status }: { status: DeviceStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function OnlineDot({ device }: { device: Pick<Device, "last_seen_at"> }) {
  const online = isOnline(device);
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-slate-600" title={device.last_seen_at ?? "never"}>
      <span className={`size-2 rounded-full ${online ? "bg-green-500" : "bg-slate-300"}`} />
      {online ? "Online" : `Seen ${timeAgo(device.last_seen_at)}`}
    </span>
  );
}

export function Battery({ level, charging }: { level: number | null; charging: boolean | null }) {
  if (level == null) return <span className="text-slate-400">—</span>;
  const color = level <= 15 ? "text-red-600" : level <= 35 ? "text-amber-600" : "text-slate-700";
  return <span className={`text-sm ${color}`}>{level}%{charging ? " ⚡" : ""}</span>;
}
