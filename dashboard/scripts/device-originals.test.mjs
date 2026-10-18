import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function moduleAt(path, imports) {
  const source = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
  const module = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', output)(name => name in imports ? imports[name] : require(name), module, module.exports);
  return module.exports;
}
function setup({ allowed = true, rpcData = { request_id: 'a'.repeat(36) }, rpcError = null, signedError = null } = {}) {
  const calls = [], signs = [];
  const db = {
    from(table) {
      assert.equal(table, 'devices');
      const query = { select() { return query; }, eq() { return query; }, async maybeSingle() { return { data: { id: 'device', school_id: 'school' } }; } };
      return query;
    },
    async rpc(name, args) { calls.push([name, args]); return { data: rpcData, error: rpcError }; },
    storage: { from(bucket) { assert.equal(bucket, 'device-file-originals'); return { async createSignedUrl(path, seconds, options) { signs.push({ path, seconds, options }); return { data: { signedUrl: 'https://storage.test/signed' }, error: signedError }; } }; } },
  };
  const exports = moduleAt('app/(app)/files/actions.ts', {
    'next/cache': { revalidatePath() {} },
    '@/lib/auth': { requireStaff: async () => ({ id: 'admin' }), canManage: () => allowed },
    '@/lib/supabase/server': { createClient: async () => db },
  });
  return { ...exports, calls, signs };
}

test('request uses an authenticated authorized RPC, not a direct command or original upload', async () => {
  const t = setup();
  assert((await t.requestOriginalFile('device', 'Download/robot.pdf', 300 * 1024 ** 2, 42)).requestId);
  assert.deepEqual(t.calls, [['request_device_file', { p_device_id: 'device', p_path: 'Download/robot.pdf', p_size: 300 * 1024 ** 2, p_modified: 42 }]]);
  assert.equal(t.signs.length, 0);
});
test('metadata and authorization reject before any request RPC', async () => {
  const t = setup();
  for (const args of [['Download/a', 500000001, 1], ['Download/a', -1, 1], ['Download/a', 2, -1], ['Download/a', NaN, 2], ['../a', 1, 1], ['/Download/a', 1, 1]]) assert((await t.requestOriginalFile('device', ...args)).error);
  assert.equal(t.calls.length, 0);
  const denied = setup({ allowed: false }); assert((await denied.requestOriginalFile('device', 'Download/a', 100, 2)).error); assert.equal(denied.calls.length, 0);
  assert((await t.requestOriginalFile('device', 'Download/a', 500000000, 2)).requestId);
});
test('non-ready, rejected and expired requests never yield an original URL', async () => {
  for (const rpcData of [{ status: 'pending' }, { status: 'failed', error: 'File changed' }, { status: 'expired' }, { status: 'ready', storage_path: 'unsafe', expires_at: '2000-01-01' }]) {
    const t = setup({ rpcData }); const result = await t.getOriginalFile('a'.repeat(36)); assert(!result.downloadUrl); assert.equal(t.signs.length, 0);
  }
  const denied = setup({ rpcError: { message: 'Transfer unavailable' } }); assert((await denied.getOriginalFile('a'.repeat(36))).error); assert.equal(denied.signs.length, 0);
});
test('ready originals use short expiry and attachment filename; credentials never returned', async () => {
  const t = setup({ rpcData: { status: 'ready', storage_path: 'school/device/request/original', filename: 'folder/robot\n.pdf', expires_at: new Date(Date.now() + 24000).toISOString() } });
  const result = await t.getOriginalFile('a'.repeat(36)); assert.equal(result.downloadUrl, 'https://storage.test/signed'); assert.equal(t.signs[0].options.download, 'folder_robot_.pdf'); assert(t.signs[0].seconds > 0 && t.signs[0].seconds <= 24); assert(t.signs[0].seconds <= 60);
  assert.deepEqual(Object.keys(result).sort(), ['downloadUrl', 'expiresAt', 'filename', 'status']);
});
test('cleanup uses Storage API before marking expired records; failures are retryable', async () => {
  for (const fails of [false, true]) {
    const events = []; let pages = 0;
    const db = { from(table) { assert.equal(table, 'device_file_transfers'); const q = { select() { return q; }, is(key, value) { assert.equal(key, 'cleaned_at'); assert.equal(value, null); return q; }, lte(key) { assert.equal(key, 'expires_at'); return q; }, order() { return q; }, async limit(n) { assert.equal(n, 100); return { data: pages++ ? [] : [{ id: 'id', storage_path: 'school/device/request/original' }] }; }, update(value) { events.push(['mark', value]); return q; }, async in() { return {}; } }; return q; }, storage: { from(bucket) { assert.equal(bucket, 'device-file-originals'); return { async remove(paths) { events.push(['remove', paths]); return { error: fails ? { message: 'offline' } : null }; } }; } } };
    const t = moduleAt('lib/device-original-cleanup.ts', { 'server-only': {}, '@/lib/supabase/admin': { createAdminClient: () => db } });
    if (fails) { await assert.rejects(t.cleanExpiredDeviceOriginals(), /retry/); assert.equal(events.length, 1); }
    else { assert.equal((await t.cleanExpiredDeviceOriginals()).removed, 1); assert.deepEqual(events.map(e => e[0]), ['remove', 'mark']); }
  }
});
test('scheduled cleanup rejects missing/wrong secrets before opening admin database', async () => {
  let called = 0;
  const t = moduleAt('app/api/device-file-cleanup/route.ts', { '@/lib/device-original-cleanup': { cleanExpiredDeviceOriginals: async () => { called++; return { removed: 0 }; } } });
  const prior = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET; assert.equal((await t.GET(new Request('https://test/'))).status, 503);
    process.env.CRON_SECRET = 'test-only-secret-'.repeat(3);
    assert.equal((await t.GET(new Request('https://test/', { headers: { authorization: 'Bearer wrong' } }))).status, 401); assert.equal(called, 0);
    assert.equal((await t.GET(new Request('https://test/', { headers: { authorization: 'Bearer ' + process.env.CRON_SECRET } }))).status, 200); assert.equal(called, 1);
  } finally { if (prior === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prior; }
});
test('cached cards show real thumbnails or explicit gaps, not synthetic covers or automatic originals', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const calls = [];
  const { CachedFiles } = moduleAt('components/cached-files.tsx', { 'next/image': { default: props => React.createElement('img', { src: props.src, alt: props.alt }) }, '@/components/device-original-download': { DeviceOriginalDownload: props => { calls.push(props); return React.createElement('button', null, 'Download original'); } } });
  const html = renderToStaticMarkup(React.createElement(CachedFiles, { deviceId: 'device', scannedAt: null, snapshot: { entries: [{ path: 'photo.jpg', name: 'photo.jpg', parent: '', dir: false, kind: 'image', size: 100, modified: 1, thumbnail: 'data:image/jpeg;base64,AAAA' }, { path: 'notes.docx', name: 'notes.docx', parent: '', dir: false, kind: 'document', size: 100, modified: 1, preview_status: 'unsupported' }], truncated: false } }));
  assert.match(html, /data:image\/jpeg;base64,AAAA/); assert.match(html, /Preview not supported/); assert.match(html, /not originals/); assert.equal(calls.length, 2);
});
test('telemetry preserves small bounds and unchanged touch, rendering actual multi-format local covers', () => {
  const source = readFileSync(new URL('../../agent/app/src/main/java/com/robokorda/primesecure/TelemetryWorker.kt', import.meta.url), 'utf8');
  for (const pattern of [/previewAttempts<24/, /entries.length\(\)<5000/, /bytes.size<25000/, /120.0/, /1750000/, /LocalMediaCovers.render/, /device_file_snapshot_touch/, /preview_status/, /startsWith\('\.'\)/]) assert.match(source, pattern);
  assert.doesNotMatch(source, /device-file-originals|asRequestBody|retrieve_file/);
});
