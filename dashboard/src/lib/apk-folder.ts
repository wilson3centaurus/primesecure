import { APK_MAX_BYTES, MAX_UPLOAD_SELECTION } from './upload-limits';
import { APK_SET_MIME, APK_PART_NAME } from './apk-set-validation';

export const MAX_APKS_PER_APP = 100;
const CHUNK_BYTES = 1_048_576;

export type ApkFolder = {
  directory: string;
  files: File[];
  rawBytes: number;
  archiveBytes: number;
};

/** One selected app folder, or a parent containing sibling app folders. */
export function groupApkFolders(files: readonly File[]): ApkFolder[] {
  const groups = new Map<string, File[]>();
  let root: string | undefined;
  for (const file of files) {
    const parts = file.webkitRelativePath.split('/');
    if (parts.length < 2 || parts.some(part => !part || part === '.' || part === '..' || /[\\:\u0000-\u001f\u007f]/.test(part)) || parts[parts.length - 1] !== file.name)
      throw new Error('Invalid app folder path. Use the folder picker and keep each app’s APKs together.');
    if (root !== undefined && root !== parts[0])
      throw new Error('Choose one app folder or one parent folder containing the app folders.');
    root = parts[0];
    if (/\.obb$/i.test(file.name)) throw new Error('OBB expansion files are unsupported. Choose an app that does not require OBB files.');
    // Readme files, icons and other non-APK sidecars are not part of an APK set.
    if (!/\.apk$/i.test(file.name)) continue;
    if (!APK_PART_NAME.test(file.name)) throw new Error(`Unsafe APK filename: ${file.name}. Use letters, numbers, dots, underscores and hyphens (up to 180 characters before .apk).`);
    if (parts.length > 3) throw new Error('Nested APK folders are unsupported. Keep base.apk and all its splits directly in each app folder.');
    const directory = parts.slice(0, -1).join('/');
    const group = groups.get(directory) ?? [];
    group.push(file);
    groups.set(directory, group);
  }
  if (!groups.size) throw new Error('No APK files found. Each app folder must contain an exact base.apk filename.');
  if (groups.size > MAX_UPLOAD_SELECTION) throw new Error('Choose up to 100 app folders per selection.');
  if (groups.has(root!) && groups.size > 1)
    throw new Error('Mixed nested app folders are unsupported. Choose one flat app folder or a parent with separate app folders.');
  return Array.from(groups, ([directory, members]) => {
    if (members.length > MAX_APKS_PER_APP) throw new Error(`${directory}: each app must contain 1 to 100 APK files.`);
    const names = new Set<string>();
    let rawBytes = 0;
    // STORE streaming ZIP: 22-byte end record, plus local/central headers and
    // a 16-byte data descriptor per file. Names are ASCII; no extras/comments.
    let archiveBytes = 22;
    for (const file of members) {
      const name = file.name.toLowerCase();
      if (names.has(name)) throw new Error(`${directory}: duplicate APK filename ${file.name}.`);
      names.add(name);
      if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error(`${directory}: APK files must be non-empty.`);
      rawBytes += file.size;
      archiveBytes += file.size + 92 + file.name.length * 2;
    }
    if (!members.some(file => file.name === 'base.apk')) throw new Error(`${directory}: missing exact base.apk. Splits cannot be uploaded as separate apps.`);
    if (rawBytes > APK_MAX_BYTES) throw new Error(`${directory}: total raw APK size must be 500 MB or less.`);
    if (archiveBytes > APK_MAX_BYTES) throw new Error(`${directory}: the .psapk archive including ZIP headers must be 500 MB or less. Choose slightly smaller APKs.`);
    const ordered = [...members].sort((a, b) => a.name === 'base.apk' ? -1 : b.name === 'base.apk' ? 1 : a.name.localeCompare(b.name));
    return { directory, files: ordered, rawBytes, archiveBytes };
  });
}

/** PrimeSecure ZIP, not bundletool .apks. APK bytes and signatures stay intact. */
export async function packApkFolder(files: readonly File[]): Promise<File> {
  const groups = groupApkFolders(files);
  if (groups.length !== 1) throw new Error('Pack exactly one app folder at a time.');
  const group = groups[0];
  const { Zip, ZipPassThrough } = await import('fflate');
  const parts: BlobPart[] = [];
  let size = 0;
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    size += chunk.byteLength;
    if (size > APK_MAX_BYTES) throw new Error('The .psapk archive must be 500 MB or less.');
    parts.push(chunk);
  });
  try {
    for (const file of group.files) {
      // ZipPassThrough is STORE (method 0 / level 0). fflate's zip({level:0})
      // still computes CRC synchronously; bounded chunks and task yields keep
      // the browser responsive without allocating every app in memory at once.
      const entry = new ZipPassThrough(file.name);
      zip.add(entry);
      for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        const end = Math.min(offset + CHUNK_BYTES, file.size);
        const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer());
        if (chunk.byteLength !== end - offset) throw new Error(`Could not read all of ${file.name}. Select the app folder again.`);
        entry.push(chunk, end === file.size);
      }
    }
    zip.end();
    if (size !== group.archiveBytes) throw new Error('Unexpected APK archive size. Select the app folder again.');
    const folder = group.directory.split('/').pop()!;
    const name = (folder.replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.{2,}/g, '_').slice(0, 174) || 'app') + '.psapk';
    return new File(parts, name, { type: APK_SET_MIME, lastModified: Math.max(...group.files.map(file => file.lastModified)) });
  } catch (error) {
    zip.terminate();
    throw error;
  }
}
