"use client";

import { useActionState } from "react";
import { X } from "lucide-react";
import { deleteWallpaper } from "@/app/(app)/library/wallpaper-actions";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";

export function WallpaperDeleteButton({ id, title, shared }: { id: string; title: string; shared: boolean }) {
  const [state, action] = useActionState(deleteWallpaper, undefined);
  return <form action={action} className="absolute right-2 top-2 z-10 max-w-[90%] text-right">
    <input type="hidden" name="id" value={id} />
    <SubmitButton
      className="inline-flex size-10 items-center justify-center rounded-full bg-white/95 text-red-700 shadow hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50"
      pending="..."
      confirm={`Delete “${title}”${shared ? " from the shared gallery for every school" : " from this school's gallery"}? This cannot be undone.`}
    ><X size={18} aria-hidden="true" /><span className="sr-only">Delete wallpaper: {title}</span></SubmitButton>
    <div className="mt-2 rounded bg-white/95 text-left"><FormMessage state={state} /></div>
  </form>;
}
