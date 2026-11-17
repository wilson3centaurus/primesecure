import { createHash } from "node:crypto";
import { Zip, ZipPassThrough, strToU8 } from "fflate";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Keep this within the production project's Fluid Compute limit. The response
// is streamed, so the function does not buffer the archive in memory.
export const maxDuration = 300;

type ExportKind = "wallpapers" | "apps" | "school-notes";
type HubKind = "wallpaper" | "app" | "resource";
type HubItem = {
  id: string;
  school_id: string | null;
  kind: HubKind;
  title: string;
  description: string;
  form_level: string;
  subject: string;
  category: string;
  storage_path: string;
  mime_type: string;
  size: number;
  package_name: string | null;
  version_name: string | null;
  sha256: string | null;
  preinstall: boolean;
  published: boolean;
  created_at: string;
};

const exportKinds: Record<ExportKind, HubKind> = {
  wallpapers: "wallpaper",
  apps: "app",
  "school-notes": "resource",
};

function safePart(value: string, fallback: string) {
  const cleaned = value.normalize("NFKC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, 120).replace(/[. ]+$/g, "") || fallback;
}

function fileExtension(path: string) {
  const name = path.split("/").pop() || "file.bin";
  const match = name.match(/(\.[A-Za-z0-9]{1,10})$/);
  return match?.[1]?.toLowerCase() || ".bin";
}

function archivePath(item: HubItem) {
  const ext = fileExtension(item.storage_path);
  const title = safePart(item.title.replace(/\.[A-Za-z0-9]{1,10}$/i, ""), "content");
  const file = `${title}--${item.id.slice(0, 8)}${ext}`;
  if (item.kind === "resource") {
    return ["school-notes", safePart(item.form_level, "All levels"), safePart(item.subject, "General"), safePart(item.category, "Notes"), file].join("/");
  }
  if (item.kind === "app") return ["apps", safePart(item.package_name || item.title, "app"), file].join("/");
  return ["wallpapers", file].join("/");
}

async function readAll<T>(load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await load(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const requested = (await params).kind as ExportKind;
  const hubKind = exportKinds[requested];
  if (!hubKind) return Response.json({ error: "Unknown factory-content export" }, { status: 404 });

  const [staff, school] = await Promise.all([requireStaff(), getCurrentSchool()]);
  if (!school || !canManage(staff, school.id)) return Response.json({ error: "Not allowed" }, { status: 403 });

  const db = await createClient();
  const [items, access] = await Promise.all([
    readAll<HubItem>((from, to) => db.from("hub_items")
      .select("id,school_id,kind,title,description,form_level,subject,category,storage_path,mime_type,size,package_name,version_name,sha256,preinstall,published,created_at")
      .eq("kind", hubKind).eq("published", true).order("created_at").order("id").range(from, to)),
    readAll<{ item_id: string }>((from, to) => db.from("hub_access").select("item_id")
      .eq("school_id", school.id).order("item_id").range(from, to)),
  ]);
  const shared = new Set(access.map((row) => row.item_id));
  const visible = items.filter((item) => item.school_id === school.id || (item.school_id === null && shared.has(item.id)));

  const createdAt = new Date().toISOString();
  if (new URL(request.url).searchParams.get("mode") === "manifest") {
    const authorized: Array<HubItem & { archive_path: string; signed_url: string }> = [];
    for (let offset = 0; offset < visible.length; offset += 100) {
      const batch = visible.slice(offset, offset + 100);
      const { data, error } = await db.storage.from("primesecure-hub")
        .createSignedUrls(batch.map((item) => item.storage_path), 60 * 60 * 24);
      if (error || !data) return Response.json({ error: error?.message || "Could not authorize export files." }, { status: 502 });
      for (let index = 0; index < batch.length; index += 1) {
        const signedUrl = data[index]?.signedUrl;
        if (!signedUrl) return Response.json({ error: `Could not authorize ${batch[index].storage_path}.` }, { status: 502 });
        authorized.push({ ...batch[index], archive_path: archivePath(batch[index]), signed_url: signedUrl });
      }
    }
    return Response.json({
      schema: "com.robokorda.primesecure.factory-content/v1", created_at: createdAt,
      school: { id: school.id, name: school.name }, export: requested,
      item_count: authorized.length, total_bytes: authorized.reduce((sum, item) => sum + Number(item.size || 0), 0), items: authorized,
    }, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
  const manifestItems: Array<Record<string, unknown>> = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const zip = new Zip((error, chunk, final) => {
        if (error) controller.error(error);
        else {
          controller.enqueue(chunk);
          if (final) controller.close();
        }
      });

      void (async () => {
        try {
          for (const item of visible) {
            const { data, error } = await db.storage.from("primesecure-hub").createSignedUrl(item.storage_path, 60 * 60 * 6);
            if (error || !data?.signedUrl) throw new Error(`Could not authorize ${item.storage_path}: ${error?.message || "no URL"}`);
            const response = await fetch(data.signedUrl, { cache: "no-store" });
            if (!response.ok || !response.body) throw new Error(`Could not download ${item.storage_path}: HTTP ${response.status}`);

            const path = archivePath(item);
            const entry = new ZipPassThrough(path);
            zip.add(entry);
            const hash = createHash("sha256");
            let bytes = 0;
            const reader = response.body.getReader();
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              bytes += value.byteLength;
              hash.update(value);
              entry.push(value);
            }
            entry.push(new Uint8Array(0), true);
            const sha256 = hash.digest("hex");
            if (bytes !== Number(item.size)) throw new Error(`Size mismatch for ${item.storage_path}: expected ${item.size}, got ${bytes}`);
            if (item.sha256 && sha256.toLowerCase() !== item.sha256.toLowerCase()) throw new Error(`SHA-256 mismatch for ${item.storage_path}`);
            manifestItems.push({ ...item, archive_path: path, size: bytes, sha256 });
          }

          const manifest = {
            schema: "com.robokorda.primesecure.factory-content/v1",
            created_at: createdAt,
            school: { id: school.id, name: school.name },
            export: requested,
            item_count: manifestItems.length,
            total_bytes: manifestItems.reduce((sum, item) => sum + Number(item.size || 0), 0),
            items: manifestItems,
          };
          const manifestEntry = new ZipPassThrough("manifest.json");
          zip.add(manifestEntry);
          manifestEntry.push(strToU8(`${JSON.stringify(manifest, null, 2)}\n`), true);
          zip.end();
        } catch (error) {
          zip.terminate();
          controller.error(error);
        }
      })();
    },
  });

  const stamp = createdAt.slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="robokorda-${requested}-${stamp}.zip"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
