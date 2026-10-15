import { dateTime } from "@/lib/format";

type NetworkReadings = {
  prime_id?: string | null;
  online?: boolean;
  wifi?: { connected?: boolean; ssid?: string; bssid?: string; rssi_dbm?: number; link_speed_mbps?: number; frequency_mhz?: number; observed_at?: string; cached?: boolean };
  location?: { observed_at?: string; cached?: boolean; note?: string };
  controls?: { bluetooth_sharing?: boolean; bluetooth_disabled?: boolean; add_users?: boolean; switch_users?: boolean; factory_reset_settings?: boolean; physical_media?: boolean; lost_mode?: boolean; limits?: string };
};

function Detail({ label, value }: { label: string; value?: string | number | null }) {
  return <div className="flex items-start justify-between gap-5 py-2 text-sm"><dt className="text-slate-500">{label}</dt><dd className="break-all text-right font-medium text-slate-800">{value ?? "Not reported"}</dd></div>;
}

/** Receives only device-reported metadata; renders no map or network scans. */
export function DeviceNetwork({ runtime, primeId, lastIp }: { runtime: { reported_at?: string | null; readings?: NetworkReadings } | null; primeId: string | null; lastIp: string | null }) {
  const readings = runtime?.readings;
  const wifi = readings?.wifi;
  const controls = readings?.controls;
  const badges = controls ? [
    ["USB / SD mounting", controls.physical_media], ["Bluetooth sharing", controls.bluetooth_sharing],
    ["Bluetooth radio", controls.bluetooth_disabled], ["Add users / guests", controls.add_users],
    ["Switch users", controls.switch_users], ["Settings reset", controls.factory_reset_settings],
  ] as const : [];

  return <section className="card p-5">
    <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-semibold">Network & device controls</h2><p className="mt-1 text-xs text-slate-500">Latest metadata reported by this Primebook.</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${wifi?.connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{wifi ? wifi.connected ? "Wi-Fi connected" : "Wi-Fi disconnected" : "Awaiting agent 0.7.0"}</span></div>
    <dl className="divide-y divide-slate-100">
      <Detail label="Prime ID (hardware Wi-Fi MAC)" value={primeId || readings?.prime_id || null} />
      <Detail label="Wi-Fi network" value={wifi?.ssid} />
      <Detail label="Access point BSSID" value={wifi?.bssid} />
      <Detail label="Signal" value={wifi?.rssi_dbm != null ? `${wifi.rssi_dbm} dBm` : null} />
      <Detail label="Link speed" value={wifi?.link_speed_mbps != null ? `${wifi.link_speed_mbps} Mbps` : null} />
      <Detail label="Frequency" value={wifi?.frequency_mhz != null ? `${wifi.frequency_mhz} MHz` : null} />
      <Detail label="Last public IP" value={lastIp} />
      <Detail label="Wi-Fi observed" value={wifi?.observed_at ? `${dateTime(wifi.observed_at)}${wifi.cached ? " · cached" : ""}` : null} />
      <Detail label="Runtime report received" value={runtime?.reported_at ? dateTime(runtime.reported_at) : null} />
    </dl>
    <p className="mt-3 text-xs leading-5 text-slate-500">Connection details may be cached or unavailable under Android permissions. Signal and network identity do not establish an exact physical location. No nearby-network scans or Wi-Fi passwords are collected.</p>
    {readings?.location?.observed_at && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Location provider diagnostics observed {dateTime(readings.location.observed_at)}{readings.location.cached ? " · cached" : ""}. Provider ages below are relative to that observation.</p>}
    {badges.length > 0 && <div className="mt-5 border-t border-slate-100 pt-4"><h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Android restriction flags</h3><div className="flex flex-wrap gap-2">{badges.map(([label, blocked]) => <span key={label} className={`rounded-lg px-2.5 py-1 text-xs ${blocked ? "bg-indigo-50 text-indigo-700" : "bg-slate-50 text-slate-500"}`}>{label}: {blocked ? "restriction set" : "not set"}</span>)}</div><p className="mt-3 text-xs leading-5 text-slate-500">Flags confirm what Android accepted; physical USB/SD, guest and Bluetooth behavior still needs testing on PrimeOS. Settings reset protection does not block recovery flashing. Firmware and login components remain protected.</p></div>}
  </section>;
}
