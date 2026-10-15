"use client";

import Image from "next/image";
import { useRef } from "react";

/** Bounded inline school profile photos; no third-party image fetches. */
export function StudentAvatar({ src, name, large = false }: { src?: string | null; name: string; large?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const photo = src && src.length <= 100000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src) ? src : null;
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  const size = large ? "size-24 rounded-2xl text-3xl" : "size-12 rounded-xl text-base";
  if (!photo) return <span className={`inline-flex shrink-0 items-center justify-center bg-gradient-to-br from-indigo-100 to-violet-100 font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200 ${size}`} title="Profile photo not provided" aria-label={`${name}: profile photo not provided`}>{initials}</span>;

  return <>
    <button type="button" className={`block shrink-0 overflow-hidden bg-slate-100 ring-1 ring-slate-200 transition hover:ring-indigo-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${size}`} onClick={() => dialog.current?.showModal()} aria-label={`Enlarge profile photo of ${name}`}>
      <Image src={photo} alt={`${name}'s profile photo`} width={large ? 96 : 48} height={large ? 96 : 48} unoptimized className="size-full object-cover" />
    </button>
    <dialog ref={dialog} className="m-auto max-h-[90svh] w-[min(90vw,46rem)] rounded-2xl border-0 bg-white p-5 text-slate-800 shadow-2xl backdrop:bg-slate-950/60" onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }} aria-label={`Profile photo of ${name}`}>
      <div className="mb-4 flex items-center justify-between gap-4"><p className="font-semibold">{name}</p><button type="button" className="btn-secondary" onClick={() => dialog.current?.close()}>Close</button></div>
      <Image src={photo} alt={`${name}'s enlarged profile photo`} width={720} height={720} unoptimized className="max-h-[70svh] w-full rounded-lg object-contain" />
    </dialog>
  </>;
}
