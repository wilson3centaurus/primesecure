/** PrimeSecure targets the current Android 11 Primebook fleet. Target SDK is NOT minimum SDK. */
export const PRIMEBOOK_BASELINE_API = 30;
export const APK_SET_MIME = 'application/vnd.primesecure.apk-set+zip';
export const APK_PART_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}\.apk$/i;
export type ApkPart = {
  name: string; packageName: string; versionCode: string; split: string;
  minSdk: number; requiredTypes: string[]; splitTypes: string[];
  requiresSplits: boolean; dependencies: string[]; configForSplit: string;
};

export function validateApkParts(parts: ApkPart[], set: boolean) {
  if (!parts.length || parts.length > 100) throw new Error('Choose 1–100 APK files for each app.');
  const names = new Set<string>(), splits = new Set<string>();
  for (const part of parts) {
    if (!APK_PART_NAME.test(part.name) || names.has(part.name.toLowerCase())) throw new Error('APK filenames must be unique and contain no folders or special characters.');
    names.add(part.name.toLowerCase());
    if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(part.packageName) || !/^\d+$/.test(part.versionCode)) throw new Error('An APK has no valid package or version code.');
    if (splits.has(part.split)) throw new Error('This app contains duplicate base or split APKs.');
    splits.add(part.split);
    if (!Number.isInteger(part.minSdk) || part.minSdk < 1 || part.minSdk > PRIMEBOOK_BASELINE_API) throw new Error(`${part.name} needs Android API ${part.minSdk || 'unknown'}. This App Store targets Primebook Android 11 (API 30); obtain an Android 11 compatible release from the publisher.`);
  }
  const base = parts.find(p => !p.split);
  if (!base || (set && base.name !== 'base.apk')) throw new Error('Select the complete app folder containing base.apk and its split APKs.');
  if (!set && (parts.length !== 1 || base.requiresSplits || base.requiredTypes.length)) throw new Error('This base APK requires companion splits. Use Upload app folder and select base.apk together with all its split APKs.');
  if (parts.some(p => p.packageName !== base.packageName || p.versionCode !== base.versionCode)) throw new Error('All APKs in an app folder must have the same package and version code. Do not mix apps or versions.');
  if (base.requiresSplits && parts.length < 2) throw new Error('This base APK is incomplete: its required split APKs are missing.');
  for (const part of parts) {
    for (const dep of [...part.dependencies, part.configForSplit].filter(Boolean)) {
      if (!splits.has(dep)) throw new Error(`${part.name} requires missing split ${dep}. Copy the complete app folder.`);
    }
    // Newer Android bundles explicitly describe required ABI/density split types.
    const supplied = new Set(parts.filter(p => p === part || p.configForSplit === part.split || (!part.split && !p.configForSplit)).flatMap(p => p.splitTypes));
    for (const type of part.requiredTypes) if (!supplied.has(type)) throw new Error(`Missing required split type ${type}. Copy all original split APKs for this app.`);
  }
  return base;
}
