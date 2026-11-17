import { Download } from "lucide-react";

const exports = [
  { kind: "wallpapers", label: "Download wallpapers", detail: "Images and catalogue manifest" },
  { kind: "apps", label: "Download apps", detail: "APK/PSAPK files and package metadata" },
  { kind: "school-notes", label: "Download school notes", detail: "Books and notes in their form/subject folders" },
] as const;

export function FactoryContentExports() {
  return (
    <section className="card mb-5 max-w-4xl p-5">
      <h2 className="text-sm font-semibold">Factory preload exports</h2>
      <p className="mt-2 text-sm text-slate-500">
        Download a versioned snapshot of the content currently available to this school. These ZIP files preserve
        the catalogue metadata and hashes used by PrimeSecure, so they can be embedded in a future PrimeOS image.
        Content added after the snapshot will continue to sync online.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {exports.map((item) => (
          <a
            key={item.kind}
            className="rounded-xl border border-line bg-panel p-4 transition hover:border-brand-300 hover:bg-brand-50"
            href={`/api/factory-content/${item.kind}`}
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-brand-700">
              <Download size={16} />
              {item.label}
            </span>
            <span className="mt-2 block text-xs text-muted">{item.detail}</span>
          </a>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Large exports stream directly from protected storage and may take time. Keep this tab open until the ZIP
        finishes downloading.
      </p>
    </section>
  );
}
