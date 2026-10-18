"use client";
import { useState } from "react";
import Image from "next/image";
import { Folder, FileText, Image as ImageIcon, Film, Music, Search, ArrowLeft, HardDrive } from "lucide-react";
import { DeviceOriginalDownload } from "@/components/device-original-download";

export type CachedEntry = { path: string; name: string; parent: string; dir: boolean; kind: string; size: number; modified: number; thumbnail?: string; managed?: boolean; preview_status?: string };
export type FileSnapshot = { entries: CachedEntry[]; truncated: boolean; inaccessible_folders?: number; free_bytes?: number; root?: string; preview_count?: number; preview_limit?: number };
const groups = [
  { id: "image", label: "Images", icon: ImageIcon, color: "bg-pink-50 text-pink-500" },
  { id: "video", label: "Videos", icon: Film, color: "bg-violet-50 text-violet-500" },
  { id: "audio", label: "Music", icon: Music, color: "bg-teal-50 text-teal-500" },
  { id: "document", label: "Documents", icon: FileText, color: "bg-blue-50 text-blue-500" },
  { id: "all", label: "Shared storage", icon: HardDrive, color: "bg-amber-50 text-amber-500" },
];
export function CachedFiles({ snapshot, scannedAt, deviceId }: { snapshot: FileSnapshot | null; scannedAt: string | null; deviceId?: string }) {
  const [path, setPath] = useState(""), [kind, setKind] = useState("all"), [query, setQuery] = useState(""), [sort, setSort] = useState("name");
  const entries = (snapshot?.entries || []).filter(e => (kind === "all" ? e.parent === path : e.kind === kind) && e.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === "size" ? b.size - a.size : sort === "recent" ? b.modified - a.modified : Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  return <section className="space-y-5">
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">{groups.map(group => <button key={group.id} onClick={() => { setKind(group.id); setPath(""); setQuery(""); }} className={`stat-card text-left ${kind === group.id ? "ring-2 ring-brand-100" : ""}`}>
      <div className={`mb-4 inline-flex rounded-xl p-3 ${group.color}`}><group.icon size={22} /></div><div className="font-semibold">{group.label}</div>
      <p className="mt-2 text-xs text-slate-400">{snapshot?.entries.filter(e => group.id === "all" || e.kind === group.id).length || 0} items</p>
    </button>)}</div>
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 p-5">
        <button className="btn-secondary" aria-label="Parent folder" onClick={() => setPath(path.split("/").slice(0, -1).join("/"))} disabled={!path || kind !== "all"}><ArrowLeft size={16} /></button>
        <span className="flex-1 text-sm font-medium text-slate-600">{kind === "all" ? `Shared storage / ${path}` : groups.find(group => group.id === kind)?.label}</span>
        <span className="text-xs text-slate-400">Cached {scannedAt ? new Date(scannedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Harare" }) : "not yet"}</span>
      </div>
      <div className="flex items-center gap-3 bg-slate-50/70 px-5 py-3"><Search size={17} className="text-slate-400" />
        <input className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="Filter cached files" placeholder="Filter files…" value={query} onChange={event => setQuery(event.target.value)} />
        <select aria-label="Sort cached files" value={sort} onChange={event => setSort(event.target.value)} className="bg-transparent text-xs text-slate-500"><option value="name">Name</option><option value="recent">Most recent</option><option value="size">Largest first</option></select>
      </div>
      <div className="grid grid-cols-2 gap-4 p-6 md:grid-cols-3 xl:grid-cols-5">{entries.map(entry => {
        const hasCover = !!entry.thumbnail && entry.thumbnail.length < 40000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(entry.thumbnail);
        const preview = <div className="mb-4 flex h-24 w-full items-center justify-center rounded-xl bg-slate-50">
          {hasCover ? <Image unoptimized src={entry.thumbnail!} width={120} height={120} alt={`Preview of ${entry.name}`} className="max-h-24 w-full object-contain" />
            : entry.dir ? <Folder size={55} fill="#ffd279" stroke="#eab458" strokeWidth={1} /> : entry.kind === "video" ? <Film size={38} className="text-violet-400" /> : entry.kind === "audio" ? <Music size={38} className="text-teal-400" /> : <FileText size={38} className="text-blue-300" />}
        </div>;
        return <article key={entry.path} className="folder-tile min-w-0">
          {entry.dir ? <button type="button" className="w-full text-left" onClick={() => { setKind("all"); setPath(entry.path); }}>{preview}<span className="block truncate text-sm font-semibold text-slate-600" title={entry.name}>{entry.name}</span></button>
            : <>{preview}<span className="w-full truncate text-sm font-semibold text-slate-600" title={entry.name}>{entry.name}</span></>}
          <span className="mt-2 text-xs text-slate-400">{entry.dir ? "Folder" : `${(entry.size / 1_000_000).toFixed(1)} MB`} · {new Date(entry.modified).toLocaleDateString("en-GB", { timeZone: "Africa/Harare" })}</span>
          {!entry.dir && !hasCover && <span className="mt-1 text-xs text-slate-400">{entry.preview_status === "budget_limited" ? "Preview outside small-cache budget" : entry.preview_status === "unsupported" ? "Preview not supported for this format" : "No cached cover available"}</span>}
          {kind !== "all" && <span className="mt-1 w-full truncate text-xs text-slate-400" title={entry.parent}>{entry.parent || "Shared storage"}</span>}
          {!entry.dir && deviceId && <DeviceOriginalDownload key={`${deviceId}:${entry.path}:${entry.size}:${entry.modified}`} deviceId={deviceId} path={entry.path} size={entry.size} modified={entry.modified} />}
        </article>;
      })}{!entries.length && <p className="col-span-full py-12 text-center text-sm text-slate-400">{snapshot ? "No matching files." : "The updated agent will upload a file inventory when it next connects."}</p>}</div>
    </div>
    <p className="text-xs leading-5 text-slate-500">Inventory remains available while the Primebook is offline. Only metadata and up to {snapshot?.preview_limit ?? 24} real, small covers are synced—not originals. PDF first pages, video frames and embedded album art are supported; unavailable covers are marked rather than invented. Originals upload only when a school administrator requests one, require the Primebook online, and expire within 24 hours. Android app-private, hidden and protected system folders are excluded.{snapshot?.truncated ? " This is a bounded snapshot of up to 5,000 entries; more files may exist." : ""}{snapshot?.inaccessible_folders ? ` ${snapshot.inaccessible_folders} folders could not be scanned.` : ""}</p>
  </section>;
}
