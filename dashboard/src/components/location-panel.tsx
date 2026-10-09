"use client";

import { useActionState } from "react";
import { requestLocate } from "@/app/(app)/commands/actions";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import type { DeviceLocation } from "@/lib/types";

const SOURCE_LABEL: Record<string, string> = {
  gps: "GPS", network: "Wi-Fi / network", fused: "Wi-Fi / network", passive: "Last known", ip: "Internet connection (approximate)",
};

function osmLink(l: DeviceLocation) {
  return `https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lng}#map=16/${l.lat}/${l.lng}`;
}

function embed(l: DeviceLocation) {
  // Zoom out for coarse fixes so the marker's uncertainty is visible in context.
  const d = Math.min(Math.max((l.accuracy ?? 500) / 111_000, 0.004), 0.3);
  const bbox = [l.lng - d, l.lat - d, l.lng + d, l.lat + d].map((v) => v.toFixed(5)).join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${l.lat},${l.lng}`;
}

export function LocationPanel({
  deviceId, locations, canLocate, times,
}: { deviceId: string; locations: DeviceLocation[]; canLocate: boolean; times: string[] }) {
  const [state, action] = useActionState(requestLocate, undefined);
  const latest = locations[0];

  return (
    <div className="space-y-3">
      {latest ? (
        <>
          <iframe title="Device location" src={embed(latest)} className="h-64 w-full rounded-md border border-slate-200" loading="lazy" />
          <p className="text-sm text-slate-600">
            {times[0]} · {SOURCE_LABEL[latest.source ?? "network"] ?? latest.source}
            {latest.accuracy != null && ` · ±${latest.accuracy >= 1000 ? `${(latest.accuracy / 1000).toFixed(1)} km` : `${Math.round(latest.accuracy)} m`}`}
            {" · "}<a href={osmLink(latest)} target="_blank" rel="noreferrer" className="text-brand-700 underline">Open map</a>
          </p>
        </>
      ) : (
        <p className="text-sm text-slate-500">No location yet.</p>
      )}
      {canLocate && (
        <form action={action} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="device_id" value={deviceId} />
          <SubmitButton className="btn-secondary" pending="Asking…">Locate now</SubmitButton>
          <FormMessage state={state} />
        </form>
      )}
      {locations.length > 1 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-500">Earlier locations</summary>
          <ul className="mt-2 space-y-1">
            {locations.slice(1).map((l, i) => (
              <li key={l.id}>
                <a href={osmLink(l)} target="_blank" rel="noreferrer" className="text-brand-700 underline">{times[i + 1]}</a>
                <span className="text-slate-500"> · {SOURCE_LABEL[l.source ?? "network"] ?? l.source}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
