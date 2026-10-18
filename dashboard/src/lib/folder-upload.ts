import type { UploadOptions } from './upload-queue';

/** Directory selection preserves the existing three-level notes hierarchy. Never silently flatten it. */
export function folderUploadOptions(file: Pick<File, 'webkitRelativePath' | 'name'>, options: UploadOptions): UploadOptions {
  if (options.kind !== 'resource' || !file.webkitRelativePath) return options;
  const relative = file.webkitRelativePath.split('/');
  const directories = relative.slice(0, -1);
  const base = [options.form, options.subject, options.category].filter(Boolean);
  const path = [...base, ...directories];
  if (relative.some(part => !part || part === '.' || part === '..' || /[\\\u0000-\u001f]/.test(part)) || path.length > 3)
    throw new Error('This folder is too deep or has an invalid path. School notes support three folder levels; choose a higher upload location or upload its subfolders separately.');
  if (path.some((part, index) => part.length > (index === 1 ? 100 : 80)))
    throw new Error('A folder name is too long. Use 80 characters or fewer (100 for the second level).');
  return { ...options, form: path[0] || '', subject: path[1] || '', category: path[2] || '', title: file.name.slice(0, 160) };
}
