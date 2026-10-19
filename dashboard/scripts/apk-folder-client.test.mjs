import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { unzipSync } from 'fflate';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
function loader(overrides = {}, globals = {}) {
  const cache = new Map();
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const targetModule = { exports: {} };
    const code = ts.transpileModule(readFileSync(new URL(relative, root), 'utf8'), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    new Function('require', 'module', 'exports', 'FormData', 'navigator', code)(name => {
      if (name in overrides) return overrides[name];
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name.startsWith('@/lib/')) return load('src/lib/' + name.slice(6) + '.ts');
      if (name.startsWith('.')) return load(new URL(name + '.ts', new URL(relative, root)).href.slice(root.href.length));
      return require(name);
    }, targetModule, targetModule.exports, globals.FormData ?? globalThis.FormData, globals.navigator ?? globalThis.navigator);
    cache.set(relative, targetModule.exports);
    return targetModule.exports;
  }
  return load;
}
function file(path, size = 8) {
  const result = new File([new Uint8Array(size).fill(37)], path.split('/').pop(), { lastModified: 1234 });
  Object.defineProperty(result, 'webkitRelativePath', { value: path.includes('/') ? path : '' });
  return result;
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = find(child, predicate);
    if (found) return found;
  }
}
function harness(enqueue, props = {}) {
  let index = 0, resets = 0;
  const slots = [];
  const hooks = {
    ...React,
    useRef(initial) { const n = index++; return slots[n] ??= { current: initial }; },
    useState(initial) {
      const n = index++;
      if (!(n in slots)) slots[n] = initial;
      return [slots[n], value => { slots[n] = typeof value === 'function' ? value(slots[n]) : value; }];
    },
  };
  const input = { files: [], _value: '', set value(value) { this._value = value; if (!value) this.files = []; }, get value() { return this._value; } };
  const form = { reset() { resets++; input.value = ''; } };
  const load = loader({
    react: hooks,
    '@/app/(app)/library/actions': {},
    './upload-queue': { useUploads: () => ({ ready: true, enqueue, setOpen() {} }) },
    './form-message': { FormMessage: () => null },
    './submit-button': { SubmitButton: () => null },
  }, { FormData: class { get(name) { return name === 'title' ? 'Custom title' : null; } } });
  const { HubUpload } = load('src/components/hub-forms.tsx');
  function render() {
    index = 0;
    const tree = HubUpload({ kind: 'app', schoolId: 'school-a', superAdmin: false, ...props });
    find(tree, node => node.props?.type === 'file').props.ref(input);
    return tree;
  }
  function select(files) { input.files = files; find(render(), node => node.props?.type === 'file').props.onChange({ target: input }); }
  function mode(value) { find(render(), node => node.props?.type === 'checkbox' && 'checked' in node.props).props.onChange({ target: { checked: value } }); render(); }
  function submit() { return render().props.onSubmit({ preventDefault() {}, currentTarget: form }); }
  function message() { return find(render(), node => node.props?.state)?.props.state; }
  function drop(files, isDirectory = false) {
    render().props.onDrop({ preventDefault() {}, dataTransfer: { files, items: [{ webkitGetAsEntry: () => ({ isDirectory }) }] } });
  }
  return { render, select, mode, submit, message, drop, input, get resets() { return resets; } };
}

test('app picker exposes explicit folder mode, resets on mode change and communicates install limits', async () => {
  const state = harness(async () => {});
  let tree = state.render();
  assert.equal(find(tree, node => node.props?.type === 'file').props.accept, '.apk,.psapk');
  const markup = JSON.stringify(tree, (_key, value) => typeof value === 'function' ? value.name : value);
  for (const text of ['Upload app folder (base + splits)', 'new PrimeSecure agent APK', 'ABI', 'Android', 'OBB', 'bundletool .apks']) assert(markup.includes(text));
  state.select([file('standalone.apk')]);
  state.mode(true);
  assert.equal(state.input.files.length, 0);
  assert.equal(state.input.webkitdirectory, true);
  assert.equal(find(state.render(), node => node.props?.type === 'file').props.accept, undefined);
  state.select([file('App/base.apk')]);
  await state.submit();
  assert.equal(state.resets, 1);
  assert.equal(state.input.files.length, 0);
  state.render();
  assert.equal(state.input.webkitdirectory, false);
  assert.match(state.message().ok, /1 app added/);
});

test('partial queue failure retries complete groups without duplicating already-saved apps', async () => {
  const accepted = [], attempts = [];
  let fail = true;
  const state = harness(async (files, school, options) => {
    attempts.push(files.map(file => file.name));
    if (files[0].name === 'B.psapk' && fail) { fail = false; throw new Error('Browser storage full'); }
    accepted.push({ files, school, options });
  });
  state.mode(true);
  state.select([file('Apps/A/base.apk'), file('Apps/A/split.apk'), file('Apps/B/base.apk'), file('Apps/B/split.apk')]);
  await state.submit();
  assert.match(state.message().error, /1 app already queued.*Browser storage full/);
  assert.equal(state.resets, 0);
  assert.equal(state.input.files.length, 4);
  await state.submit();
  assert.deepEqual(attempts, [['A.psapk'], ['B.psapk'], ['B.psapk']]);
  assert.deepEqual(accepted.map(item => item.files[0].name), ['A.psapk', 'B.psapk']);
  for (const { files, school, options } of accepted) {
    assert.equal(files.length, 1);
    assert.equal(files[0].type, 'application/vnd.primesecure.apk-set+zip');
    assert.equal(school, 'school-a');
    assert.equal(options.kind, 'app');
    assert.equal(options.title, '');
    assert.deepEqual(Object.keys(unzipSync(new Uint8Array(await files[0].arrayBuffer()))), ['base.apk', 'split.apk']);
  }
  assert.equal(state.input.files.length, 0);
});

test('validates all app groups before enqueue and failed packing remains retryable', async () => {
  const queued = [];
  const state = harness(async files => queued.push(files));
  state.mode(true);
  state.select([file('Apps/A/base.apk'), file('Apps/B/split.apk')]);
  await state.submit();
  assert.match(state.message().error, /missing exact base.apk/);
  assert.equal(queued.length, 0);
  state.select([file('App/base.apk')]);
  const original = state.input.files[0].slice.bind(state.input.files[0]);
  state.input.files[0].slice = () => { throw new Error('Read failed'); };
  await state.submit();
  assert.match(state.message().error, /Read failed/);
  assert.equal(queued.length, 0);
  state.input.files[0].slice = original;
  await state.submit();
  assert.equal(queued.length, 1);
});

test('duplicate submit is locked synchronously and drops cannot replace an active selection', async () => {
  let resolve, count = 0;
  const gate = new Promise(done => { resolve = done; });
  const state = harness(async () => { count++; await gate; });
  state.mode(true);
  const selected = [file('App/base.apk')];
  state.select(selected);
  const first = state.submit();
  await state.submit();
  assert.equal(find(state.render(), node => node.props?.type === 'file').props.disabled, true);
  state.drop([file('Different/base.apk')]);
  assert.equal(state.input.files, selected);
  resolve();
  await first;
  assert.equal(count, 1);
});

test('app folder drops give a picker error while direct file drops and resource directories retain behavior', async () => {
  const queued = [];
  const state = harness(async files => queued.push(files));
  state.mode(true);
  const selected = [file('App/base.apk')];
  state.select(selected);
  state.drop([file('Other/base.apk')], true);
  assert.match(state.message().error, /folder picker/);
  assert.equal(state.input.files, selected);
  state.mode(false);
  state.drop([file('App/base.apk')], true);
  assert.match(state.message().error, /folder picker/);
  assert.equal(state.input.files.length, 0);
  state.drop([file('ready.psapk')]);
  assert.equal(state.message(), undefined);
  await state.submit();
  assert.equal(queued[0][0].name, 'ready.psapk');
  const resources = harness(async files => queued.push(files), { kind: 'resource', folder: [] });
  resources.mode(true);
  resources.select(Array.from({ length: 101 }, (_, n) => file(`Notes/note${n}.txt`)));
  await resources.submit();
  assert.deepEqual(queued.slice(1).map(batch => batch.length), [100, 1]);
  assert.match(resources.message().ok, /101 files added/);
  assert.equal(resources.input.webkitdirectory, true);
});

function provider() {
  let index = 0;
  const saved = [];
  const load = loader({
    react: { ...React, useEffect() {}, useRef: () => ({ current: { enqueue: async entries => { saved.push(...entries); } } }), useMemo: fn => fn(), useState: initial => [index++ === 1 ? true : initial, () => {}] },
    'next/navigation': { useRouter: () => ({}) },
    '@/lib/upload-repository': {}, '@/lib/upload-transfer': {}, '@/lib/supabase/browser': {},
  }, { navigator: { storage: { estimate: async () => ({}) } } });
  const { UploadQueueProvider } = load('src/components/upload-queue.tsx');
  const tree = UploadQueueProvider({ userId: 'owner', schools: [{ id: 'school-a', name: 'School A' }], children: null });
  return { enqueue: files => tree.props.value.enqueue(files, 'school-a', { kind: 'app', title: '', shared: false }), saved, load };
}

test('queue accepts APK and PSAPK with canonical MIME and preserves generated File and per-app caps', async () => {
  const state = provider();
  const { packApkFolder } = state.load('src/lib/apk-folder.ts');
  const packed = await packApkFolder([file('App/base.apk'), file('App/split.apk')]);
  await state.enqueue([file('single.APK'), packed]);
  assert.equal(state.saved.length, 2);
  assert.deepEqual(state.saved.map(entry => entry.job.mime), ['application/vnd.android.package-archive', 'application/vnd.primesecure.apk-set+zip']);
  assert.equal(state.saved[1].file, packed);
  assert.match(state.saved[1].job.path, /\.psapk$/);
  assert.equal(state.saved[1].job.schoolId, 'school-a');
  for (const name of ['bundle.apks', 'data.obb', 'not-apk.zip']) await assert.rejects(state.enqueue([file(name)]), /\.apk or PrimeSecure \.psapk/);
  await assert.rejects(state.enqueue([file('empty.psapk', 0)]), /Empty files/);
  await assert.rejects(state.enqueue(Array.from({ length: 101 }, () => file('app.psapk'))), /1 and 100 apps/);
  const before = state.saved.length;
  await state.enqueue(Array.from({ length: 100 }, (_, n) => file(`app${n}.psapk`)));
  assert.equal(state.saved.length - before, 100);
  await state.enqueue([{ name: 'maximum.psapk', size: 500_000_000, type: 'wrong/type', webkitRelativePath: '' }]);
  assert.equal(state.saved.at(-1).job.mime, 'application/vnd.primesecure.apk-set+zip');
  await assert.rejects(state.enqueue([{ name: 'oversize.psapk', size: 500_000_001 }]), /500 MB/);
});

test('a packed File survives repository cloning and existing queue pause, restore and resume', async t => {
  const load = loader();
  const { packApkFolder } = load('src/lib/apk-folder.ts');
  const { UploadQueue } = load('src/lib/upload-queue.ts');
  const packed = await packApkFolder([file('App/base.apk'), file('App/split.apk')]);
  const jobs = new Map(), files = new Map();
  // Structured cloning matches the File/Blob storage boundary used by IndexedDB.
  const repository = {
    async list() { return [...jobs.values()].map(job => structuredClone(job)); },
    async add(entries) { for (const { job, file } of entries) { jobs.set(job.id, structuredClone(job)); files.set(job.id, structuredClone(file)); } },
    async put(job) { jobs.set(job.id, structuredClone(job)); },
    async file(id) { return files.get(id); },
    async releaseFile(id) { files.delete(id); },
  };
  let transferred = false;
  const dependencies = { repository, online: () => true, changed() {}, completed() {}, publish: async () => {}, transfer: async (job, saved) => {
    assert.equal(job.mime, packed.type);
    assert.deepEqual(new Uint8Array(await saved.arrayBuffer()), new Uint8Array(await packed.arrayBuffer()));
    transferred = true;
  } };
  let started = false;
  const first = new UploadQueue('owner', { ...dependencies, transfer: async (_job, _saved, signal) => {
    started = true;
    await new Promise((_resolve, reject) => {
      if (signal.aborted) reject(new DOMException('Paused', 'AbortError'));
      else signal.addEventListener('abort', () => reject(new DOMException('Paused', 'AbortError')), { once: true });
    });
  } });
  t.after(() => first.stop());
  await first.start(true);
  await first.enqueue([{ file: packed, job: { id: 'packed', ownerId: 'owner', state: 'queued', name: packed.name, mime: packed.type, size: packed.size, createdAt: 1, retryAt: 0, attempts: 0 } }]);
  for (let n = 0; n < 100 && !started; n++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(started, true);
  await first.pause('packed');
  assert.equal(jobs.get('packed').state, 'paused');
  assert.equal(files.has('packed'), true);
  first.stop();
  const restored = new UploadQueue('owner', dependencies);
  t.after(() => restored.stop());
  await restored.start(true);
  assert.equal(transferred, false);
  await restored.retry('packed');
  for (let n = 0; n < 100 && jobs.get('packed').state !== 'done'; n++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(transferred, true);
  assert.equal(jobs.get('packed').state, 'done');
  assert.equal(files.has('packed'), false);
});
