import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { unzipSync } from 'fflate';

const require = createRequire(import.meta.url);
const cache = new Map();
function load(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  const targetModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(name => name.startsWith('.') ? load(new URL(name + '.ts', url)) : require(name), targetModule, targetModule.exports);
  cache.set(url.href, targetModule.exports);
  return targetModule.exports;
}
const { groupApkFolders, packApkFolder } = load(new URL('../src/lib/apk-folder.ts', import.meta.url));
const { APK_SET_MIME } = load(new URL('../src/lib/apk-set-validation.ts', import.meta.url));
function file(path, bytes = new Uint8Array([0, 255, 80, 75, 3, 4])) {
  const result = new File([bytes], path.split('/').pop(), { lastModified: 1234 });
  Object.defineProperty(result, 'webkitRelativePath', { value: path });
  return result;
}
function sized(path, size) {
  return { name: path.split('/').pop(), webkitRelativePath: path, size, lastModified: 1234, slice() { throw new Error('Must validate before reading'); } };
}

test('one app folder packs a real flat STORE ZIP with unchanged APK bytes and canonical MIME', async () => {
  const base = file('Phone app/base.apk'), split = file('Phone app/split_config.arm64_v8a.apk', new Uint8Array([9, 0, 8, 255]));
  const selected = [split, file('Phone app/icon.png'), base, file('Phone app/docs/readme.txt')];
  const [group] = groupApkFolders(selected);
  assert.equal(group.directory, 'Phone app');
  assert.deepEqual(group.files, [base, split]);
  const packed = await packApkFolder(selected);
  assert(packed instanceof File);
  assert.equal(packed.name, 'Phone_app.psapk');
  assert.equal(packed.type, APK_SET_MIME);
  assert.equal(packed.lastModified, 1234);
  assert.equal(packed.size, group.archiveBytes);
  const bytes = new Uint8Array(await packed.arrayBuffer()), unzipped = unzipSync(bytes);
  assert.deepEqual(Object.keys(unzipped), ['base.apk', split.name]);
  for (const original of [base, split]) assert.deepEqual(unzipped[original.name], new Uint8Array(await original.arrayBuffer()));
  // The central directory explicitly identifies method 0 (STORE), not DEFLATE.
  const view = new DataView(bytes.buffer);
  let offset = view.getUint32(bytes.length - 6, true);
  for (let index = 0; index < 2; index++) {
    assert.equal(view.getUint32(offset, true), 0x02014b50);
    assert.equal(view.getUint16(offset + 10, true), 0);
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
});

test('parent selection groups by direct directory; splits never become individual apps', async () => {
  const selected = [file('Apps/A/base.apk'), file('Apps/B/base.apk'), file('Apps/A/split.apk'), file('Apps/B/split.apk')];
  const groups = groupApkFolders(selected);
  assert.deepEqual(groups.map(group => [group.directory, group.files.length]), [['Apps/A', 2], ['Apps/B', 2]]);
  for (const group of groups) assert.equal(Object.keys(unzipSync(new Uint8Array(await (await packApkFolder(group.files)).arrayBuffer()))).length, 2);
  await assert.rejects(packApkFolder(selected), /exactly one/);
});

test('generated archive names fit storage paths without introducing traversal-like dot sequences', async () => {
  assert.equal((await packApkFolder([file('App..copy/base.apk')])).name, 'App_copy.psapk');
  const packed = await packApkFolder([file('x'.repeat(250) + '/base.apk')]);
  assert.equal(packed.name.length, 180);
  assert(packed.name.endsWith('.psapk'));
});

test('exact base.apk is required independently in every group, including single-APK folders', async () => {
  for (const selected of [[], [file('App/split.apk')], [file('App/BASE.APK')], [file('Apps/A/base.apk'), file('Apps/B/split.apk')], [file('App/readme.txt')]])
    assert.throws(() => groupApkFolders(selected), /base\.apk/);
  assert.equal(groupApkFolders([file('App/base.apk')])[0].files.length, 1);
  assert((await packApkFolder([file('App/base.apk')])).size > 0);
});

test('rejects nesting, mixed roots, path traversal, unsafe names and file/path mismatches', () => {
  const bad = [
    'base.apk', '/App/base.apk', 'App//base.apk', 'App/../base.apk', 'App/./base.apk',
    'App\\bad/base.apk', 'C:/App/base.apk', 'App/\u0000/base.apk', 'App/base with spaces.apk',
    'App/.hidden.apk', 'App/-split.apk', 'App/' + 'a'.repeat(181) + '.apk',
    'Apps/A/nested/base.apk',
  ];
  for (const path of bad) assert.throws(() => groupApkFolders([file(path)]), undefined, path);
  assert.throws(() => groupApkFolders([file('Apps/base.apk'), file('Apps/Child/base.apk')]), /Mixed nested/);
  assert.throws(() => groupApkFolders([file('A/base.apk'), file('B/base.apk')]), /one parent/);
  const mismatch = file('App/base.apk');
  Object.defineProperty(mismatch, 'name', { value: 'other.apk' });
  assert.throws(() => groupApkFolders([mismatch]), /path/);
  assert.equal(groupApkFolders([file('App/base.apk'), file('App/' + 'a'.repeat(180) + '.apk')])[0].files.length, 2);
});

test('duplicate filenames are rejected case-insensitively; OBBs are explicitly unsupported anywhere', () => {
  for (const selected of [[file('App/base.apk'), file('App/base.apk')], [file('App/base.apk'), file('App/BASE.APK')], [file('App/base.apk'), file('App/split.apk'), file('App/SPLIT.APK')]])
    assert.throws(() => groupApkFolders(selected), /duplicate/);
  for (const path of ['App/main.obb', 'App/Android/obb/main.OBB'])
    assert.throws(() => groupApkFolders([file('App/base.apk'), file(path)]), /OBB.*unsupported/);
});

test('caps are per app: 100 apps and 100 APKs each, with 500 MB raw and archive boundaries', async () => {
  const apps = Array.from({ length: 100 }, (_, n) => file(`Apps/App${n}/base.apk`));
  assert.equal(groupApkFolders(apps).length, 100);
  assert.throws(() => groupApkFolders([...apps, file('Apps/Extra/base.apk')]), /100 app folders/);
  const parts = [file('App/base.apk'), ...Array.from({ length: 99 }, (_, n) => file(`App/split${n}.apk`))];
  assert.equal(groupApkFolders(parts)[0].files.length, 100);
  assert.throws(() => groupApkFolders([...parts, file('App/extra.apk')]), /1 to 100 APK/);
  assert.throws(() => groupApkFolders([file('App/base.apk', new Uint8Array())]), /non-empty/);
  assert.throws(() => groupApkFolders([sized('App/base.apk', 500_000_001)]), /raw APK size/);
  assert.throws(() => groupApkFolders([sized('App/base.apk', 499_999_999), sized('App/split.apk', 2)]), /raw APK size/);
  assert.throws(() => groupApkFolders([sized('App/base.apk', 500_000_000)]), /including ZIP headers/);
  const overhead = 22 + 92 + 'base.apk'.length * 2;
  const maximum = groupApkFolders([sized('App/base.apk', 500_000_000 - overhead)])[0];
  assert.equal(maximum.archiveBytes, 500_000_000);
  assert.throws(() => groupApkFolders([sized('App/base.apk', 500_000_001 - overhead)]), /including ZIP headers/);
  assert.equal(groupApkFolders([sized('Apps/A/base.apk', 300_000_000), sized('Apps/B/base.apk', 300_000_000)]).length, 2);
  await assert.rejects(packApkFolder([sized('App/base.apk', 500_000_001)]), /raw APK size/);
});

test('packing yields between bounded chunks and read failures can be retried cleanly', async () => {
  const original = file('App/base.apk', new Uint8Array(2_500_000).fill(171));
  let ticks = 0;
  const timer = setInterval(() => ticks++, 0);
  try {
    const packed = await packApkFolder([original]);
    assert(ticks >= 3, 'browser tasks get a turn while packing each chunk');
    assert.deepEqual(unzipSync(new Uint8Array(await packed.arrayBuffer()))['base.apk'], new Uint8Array(await original.arrayBuffer()));
  } finally { clearInterval(timer); }
  const broken = sized('App/base.apk', 10);
  await assert.rejects(packApkFolder([broken]), /Must validate before reading/);
  broken.slice = () => new Blob([new Uint8Array(9)]);
  await assert.rejects(packApkFolder([broken]), /Could not read all/);
  assert((await packApkFolder([file('App/base.apk')])).size > 0);
});
