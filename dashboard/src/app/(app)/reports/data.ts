export type ReportDevice = { id: string; student_name: string | null; student_id?: string | null; prime_id: string | null; form_level: string; class_name: string; screen_ms: number; online_ms: number; uptime_ms: number; reported_days: number; usage_access: boolean; usage_access_days?: number; last_reported_at: string | null; coverage?: string[] };
export type ReportApp = { package: string; label: string; foreground_ms: number; device_count: number };
export type UsageReport = { devices: ReportDevice[]; apps: ReportApp[]; totals: { screen_ms: number; online_ms: number; uptime_ms: number; reporting_devices: number; app_package_count: number }; days: number };

export function duration(milliseconds: number): string {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  if (minutes < 1) return milliseconds > 0 ? "<1 min" : "0 min";
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
