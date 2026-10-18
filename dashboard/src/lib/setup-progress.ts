export const SETUP_STREAMS = [
  { kind: "wallpaper", label: "Wallpapers" },
  { kind: "app", label: "Apps" },
  { kind: "resource", label: "School notes" },
] as const;
export type SetupKind = (typeof SETUP_STREAMS)[number]["kind"];
export type SetupStream = { kind: SetupKind; label: string; total_items: number; completed_items: number;
  total_bytes: number; completed_bytes: number; elapsed_ms: number; complete: boolean };
export type SetupReport = { streams: SetupStream[]; elapsed_ms: number; complete: boolean; clock_estimated: boolean };
export type SetupRecord = { device_id: string; reported_at: string; report: unknown };
export type SetupSummary = { reporting_devices: number; complete_devices: number; setup_samples: number;
  avg_setup_ms: number | null; streams: { kind: SetupKind; samples: number; avg_elapsed_ms: number | null }[] };

/** Missing reports must never render a fabricated 0% or completed setup. */
export function setupReport(value: unknown): SetupReport | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.catalog_known !== true || !Array.isArray(v.streams) || v.streams.length !== 3 ||
    typeof v.complete !== "boolean" || !counter(v.elapsed_ms)) return null;
  const streams: SetupStream[] = [];
  for (const { kind, label } of SETUP_STREAMS) {
    const matches = v.streams.filter((s) => s && typeof s === "object" && s.kind === kind);
    if (matches.length !== 1) return null;
    const s = matches[0] as Record<string, unknown>;
    if (![s.total_items, s.completed_items, s.total_bytes, s.completed_bytes, s.elapsed_ms].every(counter) ||
      Number(s.completed_items) > Number(s.total_items) || Number(s.completed_bytes) > Number(s.total_bytes) ||
      Number(s.elapsed_ms) > v.elapsed_ms || s.complete !== (s.completed_items === s.total_items)) return null;
    streams.push({ kind, label, total_items: Number(s.total_items), completed_items: Number(s.completed_items),
      total_bytes: Number(s.total_bytes), completed_bytes: Number(s.completed_bytes), elapsed_ms: Number(s.elapsed_ms), complete: s.complete });
  }
  if (v.complete !== streams.every((s) => s.complete)) return null;
  return { streams, elapsed_ms: v.elapsed_ms, complete: v.complete, clock_estimated: v.clock_estimated === true };
}
function counter(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }

export type WallpaperSetting = { scope: string; school_id: string | null; default_wallpaper_id: string | null; allow_wallpaper_choice: boolean };
export type WallpaperPreview = { id: string; title: string; storage_path: string; school_id: string | null; published: boolean };

/** Mirrors catalogue choice/default precedence, without claiming the device applied this configuration. */
export function effectiveWallpaper(schoolId: string, choiceId: string | null, settings: WallpaperSetting[], items: WallpaperPreview[], sharedChoiceIds: string[]) {
  const school = settings.find((setting) => setting.school_id === schoolId);
  const master = settings.find((setting) => setting.scope === "global" && setting.school_id === null);
  const visible = (id: string | null | undefined) => items.find((item) => item.id === id && item.published && (item.school_id === null || item.school_id === schoolId));
  const choice = visible(choiceId);
  if ((school?.allow_wallpaper_choice ?? master?.allow_wallpaper_choice ?? true) && choice &&
    (choice.school_id === schoolId || sharedChoiceIds.includes(choice.id))) {
    return { item: choice, label: "Student choice (last synced)" };
  }
  const schoolDefault = visible(school?.default_wallpaper_id);
  if (schoolDefault) return { item: schoolDefault, label: "Inherited school default (last config, not confirmed device applied)" };
  const masterDefault = visible(master?.default_wallpaper_id);
  return masterDefault?.school_id === null ? { item: masterDefault, label: "Inherited master default (last config, not confirmed device applied)" } : null;
}

export function streamPercent(stream: SetupStream) {
  if (stream.complete) return 100;
  const progress = stream.total_bytes > 0 ? stream.completed_bytes / stream.total_bytes :
    stream.total_items > 0 ? stream.completed_items / stream.total_items : 0;
  return Math.max(0, Math.min(99, Math.floor(progress * 100)));
}
export function setupDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "Not yet measured";
  if (ms < 1000) return "<1 sec";
  if (ms < 60_000) return `${Math.floor(ms / 1000)} sec`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ${Math.floor(ms % 60_000 / 1000)} sec`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} hr ${Math.floor(ms % 3_600_000 / 60_000)} min`;
  return `${Math.floor(ms / 86_400_000)} days ${Math.floor(ms % 86_400_000 / 3_600_000)} hr`;
}
