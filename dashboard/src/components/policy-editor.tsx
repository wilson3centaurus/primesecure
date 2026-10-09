"use client";

import { useActionState, useState } from "react";
import { removePolicy, savePolicy } from "@/app/(app)/policy/actions";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { createClient } from "@/lib/supabase/browser";
import type { Policy } from "@/lib/types";

const COMMON_APPS = [
  ["com.android.chrome", "Chrome"],
  ["com.android.vending", "Play Store"],
  ["com.google.android.youtube", "YouTube"],
  ["com.whatsapp", "WhatsApp"],
  ["com.facebook.katana", "Facebook"],
  ["com.zhiliaoapp.musically", "TikTok"],
] as const;

function Toggle({ name, label, hint, defaultChecked, disabled }: { name: string; label: string; hint: string; defaultChecked: boolean; disabled: boolean }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled} className="mt-1 size-4 accent-brand-600" />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </label>
  );
}

export function PolicyEditor({
  policy, schoolId, deviceId, canEdit,
}: { policy: Policy | null; schoolId: string; deviceId?: string; canEdit: boolean }) {
  const [state, action] = useActionState(savePolicy, undefined);
  const [removeState, removeAction] = useActionState(removePolicy, undefined);
  const [wallpaper, setWallpaper] = useState(policy?.wallpaper_url ?? "");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [webMode, setWebMode] = useState(policy?.web_filter ?? "off");

  async function upload(file: File) {
    setUploadError("");
    if (!file.type.startsWith("image/")) return setUploadError("Pick an image file.");
    if (file.size > 10 * 1024 * 1024) return setUploadError("Image must be under 10 MB.");
    setUploading(true);
    const supabase = createClient();
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const path = `${schoolId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("wallpapers").upload(path, file, { contentType: file.type });
    setUploading(false);
    if (error) return setUploadError(error.message);
    setWallpaper(supabase.storage.from("wallpapers").getPublicUrl(path).data.publicUrl);
  }

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-6">
        <input type="hidden" name="school_id" value={schoolId} />
        {deviceId && <input type="hidden" name="device_id" value={deviceId} />}
        <input type="hidden" name="wallpaper_url" value={wallpaper} />

        <section className="card space-y-3 p-4">
          <h2 className="font-semibold">Wallpaper</h2>
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex aspect-video w-64 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100 text-xs text-slate-400">
              {/* eslint-disable-next-line @next/next/no-img-element -- user-uploaded, any host */}
              {wallpaper ? <img src={wallpaper} alt="Wallpaper preview" className="size-full object-cover" /> : "No wallpaper set"}
            </div>
            {canEdit && (
              <div className="space-y-2">
                <input type="file" accept="image/*" disabled={uploading} aria-label="Upload wallpaper"
                  onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="block text-sm" />
                {uploading && <p className="text-sm text-slate-500">Uploading…</p>}
                {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
                {wallpaper && <button type="button" className="text-sm text-slate-600 underline" onClick={() => setWallpaper("")}>Clear wallpaper</button>}
                <p className="text-xs text-slate-500">Clearing keeps whatever wallpaper the device last had.</p>
              </div>
            )}
          </div>
          <Toggle name="lock_wallpaper" label="Lock wallpaper" hint="Students can't change it." defaultChecked={policy?.lock_wallpaper ?? false} disabled={!canEdit} />
        </section>

        <section className="card space-y-3 p-4">
          <h2 className="font-semibold">Restrictions</h2>
          <Toggle name="block_installs" label="Block app installs" hint="Students can't install APKs from files or browsers." defaultChecked={policy?.block_installs ?? false} disabled={!canEdit} />
          <Toggle name="hide_settings" label="Hide Settings" hint="The Settings app disappears from the launcher." defaultChecked={policy?.hide_settings ?? false} disabled={!canEdit} />
        </section>

        <section className="card grid gap-4 p-4 md:grid-cols-2">
          <div>
            <label htmlFor="hidden_apps" className="label">Hidden apps</label>
            <textarea id="hidden_apps" name="hidden_apps" rows={6} disabled={!canEdit} className="input font-mono"
              defaultValue={(policy?.hidden_apps ?? []).join("\n")} placeholder="com.android.vending" />
            <p className="mt-1 text-xs text-slate-500">One package name per line. These apps disappear from the launcher.</p>
          </div>
          <div>
            <label htmlFor="allowed_apps" className="label">Allowed apps only</label>
            <textarea id="allowed_apps" name="allowed_apps" rows={6} disabled={!canEdit} className="input font-mono"
              defaultValue={(policy?.allowed_apps ?? []).join("\n")} placeholder="Leave empty to allow everything" />
            <p className="mt-1 text-xs text-slate-500">
              If set, every other app is hidden (the launcher, keyboard and PrimeSecure always stay).
              Also the apps that stay usable while a device is suspended.
            </p>
          </div>
          <div className="text-xs text-slate-500 md:col-span-2">
            Common packages: {COMMON_APPS.map(([pkg, name], i) => (
              <span key={pkg}>{i > 0 && " · "}{name} <code className="rounded bg-slate-100 px-1">{pkg}</code></span>
            ))}
          </div>
        </section>

        <section className="card space-y-4 p-4">
          <div>
            <h2 className="font-semibold">Web filtering</h2>
            <p className="text-xs text-slate-500">
              Enforced in Chrome and in the School Browser (which appears on devices once filtering is on).
              To stop students using other browsers, hide them above or use Allowed apps.
            </p>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            {([["off", "No filtering"], ["blocklist", "Block listed sites"], ["allowlist", "Only allow listed sites"]] as const).map(([v, l]) => (
              <label key={v} className="flex items-center gap-2">
                <input type="radio" name="web_filter" value={v} checked={webMode === v} disabled={!canEdit}
                  onChange={() => setWebMode(v)} className="accent-brand-600" />
                {l}
              </label>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className={webMode === "blocklist" ? "" : "hidden"}>
              <label htmlFor="web_blocklist" className="label">Blocked websites</label>
              <textarea id="web_blocklist" name="web_blocklist" rows={5} disabled={!canEdit} className="input font-mono"
                defaultValue={(policy?.web_blocklist ?? []).join("\n")} placeholder={"tiktok.com\nfacebook.com"} />
              <p className="mt-1 text-xs text-slate-500">One per line. A domain also covers its subdomains.</p>
            </div>
            <div className={webMode === "allowlist" ? "" : "hidden"}>
              <label htmlFor="web_allowlist" className="label">Allowed websites</label>
              <textarea id="web_allowlist" name="web_allowlist" rows={5} disabled={!canEdit} className="input font-mono"
                defaultValue={(policy?.web_allowlist ?? []).join("\n")} placeholder={"wikipedia.org\nkhanacademy.org"} />
              <p className="mt-1 text-xs text-slate-500">Everything else is blocked. The home page is always allowed.</p>
            </div>
            <div>
              <label htmlFor="browser_home_url" className="label">Home page</label>
              <input id="browser_home_url" name="browser_home_url" type="url" disabled={!canEdit} className="input"
                defaultValue={policy?.browser_home_url ?? ""} placeholder="https://kolibri.yourschool.local" />
            </div>
          </div>
          <Toggle name="safe_search" label="Force SafeSearch" hint="Google SafeSearch and YouTube restricted mode in Chrome; SafeSearch in the School Browser."
            defaultChecked={policy?.safe_search ?? false} disabled={!canEdit} />
        </section>

        {canEdit && (
          <div className="flex items-center gap-3">
            <SubmitButton disabled={uploading}>Save policy</SubmitButton>
            <FormMessage state={state} />
          </div>
        )}
      </form>

      {canEdit && policy?.id && (
        <form action={removeAction} className="flex items-center gap-3 border-t border-slate-200 pt-4">
          <input type="hidden" name="school_id" value={schoolId} />
          {deviceId && <input type="hidden" name="device_id" value={deviceId} />}
          <SubmitButton className="btn-secondary" pending="Removing…"
            confirm={deviceId ? "Remove this device's own policy? It will follow the school policy again." : "Remove the school policy? Devices without their own policy lose every restriction."}>
            {deviceId ? "Use school policy instead" : "Remove school policy"}
          </SubmitButton>
          <FormMessage state={removeState} />
        </form>
      )}
    </div>
  );
}
