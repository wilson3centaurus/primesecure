import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const asset = new URL('../agent/app/src/main/assets/student/', import.meta.url);
const source = readFileSync(new URL('workspace.js', asset), 'utf8');
const css = readFileSync(new URL('workspace.css', asset), 'utf8');
const native = readFileSync(new URL('../agent/app/src/main/java/com/robokorda/primesecure/HubActivity.kt', import.meta.url), 'utf8');
const store = readFileSync(new URL('../agent/app/src/main/java/com/robokorda/primesecure/HubStore.kt', import.meta.url), 'utf8');
const item = (id, title, extra = {}) => ({ id, title, kind: 'resource', form_level: 'Form 1', subject: 'Robotics', category: 'Images', storage_path: `${id}.jpg`, mime_type: 'image/jpeg', available: true, size: 1024, ...extra });
const catalog = extra => ({ device_id: 'device-a', student_id: 'student-a', student_name: 'Learner', student_profile: {}, items: [], messages: [], tasks: [], hidden_keys: [], favorite_keys: [], pinned_keys: [], online: true, capabilities: { favorites: true, delete_personal_media: true, media_batch: true, resource_covers: true }, ...extra });

// No DOM package is present in the existing tests. This small DOM boundary runs the
// complete bundled workspace (not extracted/reimplemented functions) and its real
// delegated click/change handlers. Markup is inspected as rendered by that code.
function workspace(initial = catalog()) {
  const elements = new Map(), listeners = new Map(), calls = [], localWrites = [];
  const element = (id = '', dataset = {}) => ({
    id, dataset, innerHTML: '', textContent: '', hidden: false, open: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, removeAttribute() {}, addEventListener() {}, focus() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, contains() { return false; },
    replaceChildren() { this.innerHTML = ''; }, close() { this.open = false; }, showModal() { this.open = true; },
    hasAttribute(name) { return name.startsWith('data-') && name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()) in this.dataset; },
    closest(selector) { return selector.includes('button') ? this : null; },
  });
  const document = {
    documentElement: element(), activeElement: null, visibilityState: 'visible',
    getElementById(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener(type, fn, capture = false) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push({ fn, capture }); },
  };
  const matchMedia = () => ({ matches: false, addEventListener() {} });
  const window = { matchMedia, scrollTo() {}, PrimeNative: { request(raw) { calls.push(JSON.parse(raw)); } } };
  const context = vm.createContext({ document, window, matchMedia, localStorage: { getItem() { return null; }, setItem(...args) { localWrites.push(args); } }, setTimeout() { return 1; }, clearTimeout() {}, URL, HTMLImageElement: class {}, confirm() { return true; }, console });
  vm.runInContext(source, context, { filename: 'workspace.js' });
  window.receiveState(JSON.stringify(initial));
  return {
    calls, localWrites, window,
    run(code) { return vm.runInContext(code, context); },
    html(id = 'workspace-page') { return document.getElementById(id).innerHTML; },
    page(name) { vm.runInContext(`view=${JSON.stringify(name)};renderPage(true)`, context); return this.html(); },
    dispatch(type, dataset = {}, options = {}) {
      const target = Object.assign(element('', dataset), options);
      const event = { target, stopped: false, stopImmediatePropagation() { this.stopped = true; }, preventDefault() {} };
      for (const { fn } of [...(listeners.get(type) || [])].sort((a, b) => Number(b.capture) - Number(a.capture))) { fn(event); if (event.stopped) break; }
      return target;
    },
  };
}

test('undeletable colorful virtual Favorites exist even in an empty Notes or Media library', () => {
  const ui = workspace();
  for (const page of ['School Notes', 'Media']) {
    const html = ui.page(page);
    assert.match(html, /favorites-folder/);
    assert.match(html, /Favorites/);
    const tile = html.match(/<article class="folder favorites-folder">[\s\S]*?<\/article>/)[0];
    assert.doesNotMatch(tile, /data-hide|delete|tile-check|tile-menu/);
  }
  assert.match(css, /\.favorites-folder[^}]+linear-gradient/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\).*favorite/);
});

test('hearts call native persistence, turn red and open Favorites without file copies', () => {
  const ui = workspace(catalog({ items: [item('one', 'Robot joints')] }));
  ui.page('School Notes');
  ui.dispatch('click', { favorite: 'item:one' });
  assert.deepEqual(ui.calls.at(-1), { action: 'favorite', key: 'item:one', value: true, device_id: 'device-a', student_id: 'student-a' });
  ui.dispatch('click', { favoritesOpen: 'notes' });
  assert.match(ui.html(), /tile-heart is-favorite/);
  assert.match(ui.html(), /Robot joints/);
  assert.match(ui.html(), /data-pin="item:one"/);
  ui.dispatch('click', { favorite: 'item:one' });
  assert.equal(ui.calls.at(-1).value, false);
  assert.match(ui.html('note-results'), /Your Favorites are ready/);
  assert.equal(ui.localWrites.length, 0);
  assert(!ui.calls.some(c => /copy|delete/.test(c.action)));
});

test('native preference acknowledgment and reopening restore saved hearts', () => {
  const ui = workspace(catalog({ items: [item('one', 'Saved book')] }));
  ui.page('School Notes');
  ui.window.receiveLibraryPreferences(JSON.stringify({ device_id: 'device-a', student_id: 'student-a', favorite_keys: ['item:one'], pinned_keys: ['item:one'] }));
  ui.dispatch('click', { favoritesOpen: 'notes' });
  assert.match(ui.html(), /tile-heart is-favorite/);
  assert.match(ui.html(), /tile-pin is-pinned/);
  const reopened = workspace(catalog({ items: [item('one', 'Saved book')], favorite_keys: ['item:one'] }));
  reopened.page('School Notes');
  reopened.dispatch('click', { favoritesOpen: 'notes' });
  assert.match(reopened.html(), /Saved book/);
});

test('pinned favorite resources and normal folders sort first; folder references open originals', () => {
  const ui = workspace(catalog({ items: [item('a', 'Alpha'), item('z', 'Zulu')], favorite_keys: ['item:a', 'item:z'] }));
  ui.page('School Notes');
  ui.dispatch('click', { favoritesOpen: 'notes' });
  ui.dispatch('click', { pin: 'item:z' });
  assert(ui.html('note-results').indexOf('data-note-select="z"') < ui.html('note-results').indexOf('data-note-select="a"'));
  assert.deepEqual(ui.calls.at(-1), { action: 'pin', key: 'item:z', value: true, device_id: 'device-a', student_id: 'student-a' });
  ui.run(`state.items.push({...state.items[0],id:'b',title:'Other',form_level:'Form 2'});rebuildIndex()`);
  ui.dispatch('click', { notesRoot: '' });
  ui.dispatch('click', { pin: 'folder:form:Form 2', prefFolder: '["Form 2"]' });
  assert(ui.html('note-results').indexOf('Select folder Form 2') < ui.html('note-results').indexOf('Select folder Form 1'));
  ui.dispatch('click', { favorite: 'folder:form:Form 2', prefFolder: '["Form 2"]' });
  ui.dispatch('click', { favoritesOpen: 'notes' });
  assert.match(ui.html(), /Select folder Form 2/);
  ui.dispatch('click', { notesPath: '["Form 2"]' });
  assert.equal(ui.run('notesFavorites'), false);
  assert.equal(ui.run('folder[0]'), 'Form 2');
});

test('notes cards open directly, with checkbox/heart/eye and no menu, file size or copy controls', () => {
  const ui = workspace(catalog({ items: [item('one', '<b>Safe title</b>')] }));
  const html = ui.run('resourceCard(state.items[0])');
  for (const control of ['data-note-select', 'data-favorite', 'data-hide', 'data-action="resource"']) assert(html.includes(control));
  assert.doesNotMatch(html, /tile-menu|Copy to Documents|data-note-copy|1 KB/);
  assert.match(html, /&lt;b&gt;Safe title&lt;\/b&gt;/);
  assert(html.indexOf('tile-check') < html.indexOf('tile-heart'));
  assert.match(ui.run('noteResults()'), /Select all/);
});

test('search includes un-downloaded catalog documents, not only ready files', () => {
  const ui = workspace(catalog({ items: [item('one', 'How robots work', { available: false }), item('two', 'Garden')] }));
  ui.run("noteQuery='robots';rebuildIndex()");
  const html = ui.run('noteResultsRaw()');
  assert.match(html, /How robots work/);
  assert.match(html, /Tap to save/);
  assert.match(html, /including pending downloads/);
  assert.doesNotMatch(html, /data-note-select="two"/);
});

test('personal Media has checkbox/heart, bottom-left bin and bottom-right Open; native confirmation stays', () => {
  const ui = workspace();
  ui.page('Media');
  ui.window.receiveFiles(JSON.stringify({ entries: [{ name: 'Example.jpg', path: 'Pictures/Example.jpg', size: 1024 }] }));
  ui.run("fileKind='image'");
  const html = ui.run('personalMediaResults()');
  assert.match(html, /data-media-select/);
  assert.match(html, /data-favorite="media:Pictures\/Example.jpg"/);
  assert(html.indexOf('tile-bin') < html.indexOf('media-open'));
  assert.doesNotMatch(html, /tile-menu|Copy to Documents|1 KB/);
  ui.dispatch('click', { action: 'delete_media', path: 'Pictures/Example.jpg' });
  assert.deepEqual(ui.calls.at(-1), { action: 'delete_media', path: 'Pictures/Example.jpg' });
  assert.match(native, /"delete_media" -> confirmMediaDeletion/);
  assert.match(native, /setNegativeButton\("Cancel"\)/);
});

test('Media Favorites combine categories and deletion removes stale references', () => {
  const ui = workspace(catalog({ favorite_keys: ['media:Pictures/a.jpg', 'media:Music/b.mp3'] }));
  ui.page('Media');
  ui.window.receiveFiles(JSON.stringify({ entries: [{ name: 'a.jpg', path: 'Pictures/a.jpg' }, { name: 'b.mp3', path: 'Music/b.mp3' }] }));
  ui.dispatch('click', { favoritesOpen: 'media' });
  assert.match(ui.html(), /a.jpg/);
  assert.match(ui.html(), /b.mp3/);
  ui.window.mediaFileDeleted('Pictures/a.jpg');
  assert.doesNotMatch(ui.html(), /data-media-select="Pictures\/a.jpg"/);
  assert.equal(ui.run("favorite('media:Pictures/a.jpg')"), false);
});

test('school Media originals are never offered to personal file deletion', () => {
  const ui = workspace(catalog({ prime_media: { enabled: true }, items: [item('school', 'School music', { kind: 'media', mime_type: 'audio/mpeg' })] }));
  ui.run("fileKind='music'");
  ui.page('Media');
  const html = ui.run('mediaResults()');
  assert.match(html, /data-school-media-select="school"/);
  assert.doesNotMatch(html, /data-action="delete_media"/);
  ui.dispatch('change', { schoolMediaSelect: 'school' }, { checked: true });
  ui.dispatch('click', { mediaBulk: 'delete' });
  assert(!ui.calls.some(c => c.action === 'delete_media_batch'));
  ui.dispatch('click', { schoolMediaHide: '' });
  assert.doesNotMatch(ui.html(), /data-school-media-select="school"/);
  ui.dispatch('click', { mediaShowHidden: '' });
  assert.match(ui.html(), /data-school-media-select="school"/);
  ui.dispatch('click', { hide: 'item:school', hidden: 'true' });
  assert.equal(ui.run('state.hidden_keys.length'), 0);
});

test('identity reset clears view selections and never exposes another student Favorites', () => {
  const ui = workspace(catalog({ items: [item('one', 'Private favorite')], favorite_keys: ['item:one'] }));
  ui.dispatch('click', { favoritesOpen: 'notes' });
  ui.window.receiveState(JSON.stringify(catalog({ device_id: 'device-b', student_id: 'student-b' })));
  assert.equal(ui.run('notesFavorites'), false);
  assert.equal(ui.run('mediaFavorites'), false);
  assert.equal(ui.run('favorite("item:one")'), false);
  assert.equal(ui.run('noteSelected.size'), 0);
  ui.window.receiveLibraryPreferences(JSON.stringify({ device_id: 'device-a', student_id: 'student-a', favorite_keys: ['item:one'], pinned_keys: [] }));
  assert.equal(ui.run('favorite("item:one")'), false, 'late acknowledgment from a previous student must be ignored');
  ui.window.receiveState(JSON.stringify({ ...catalog(), enrolled: false }));
  const before = ui.calls.length;
  ui.dispatch('click', { favorite: 'item:one' });
  assert.equal(ui.calls.length, before);
  assert.match(ui.html('app'), /School setup required/);
});

test('wallpaper label follows successful native application, not the click', () => {
  const wallpaper = item('wall', 'Sunset', { kind: 'wallpaper' });
  const ui = workspace(catalog({ items: [wallpaper], allow_wallpaper_choice: true }));
  assert.doesNotMatch(ui.page('Wallpapers'), />Current wallpaper</);
  ui.dispatch('click', { action: 'wallpaper', id: 'wall' });
  assert.doesNotMatch(ui.page('Wallpapers'), />Current wallpaper</);
  ui.window.receiveState(JSON.stringify(catalog({ items: [wallpaper], allow_wallpaper_choice: true, current_wallpaper_id: 'wall' })));
  assert.match(ui.html(), /current-wallpaper/);
  assert.match(ui.html(), />Current wallpaper</);
  assert.match(ui.html(), /data-id="wall" disabled/);
  assert(native.indexOf('.setWallpaper("hub:"') < native.indexOf('hub.localWallpaper=item.getString("id")'));
});

test('exactly three setup tabs use complete catalog totals independently of task history', () => {
  const streams = ['wallpaper', 'app', 'resource'].map(kind => ({ kind, label: kind, total_items: 1200, completed_items: 600, total_bytes: 10000, completed_bytes: 5000, elapsed_ms: 123000, complete: false }));
  const ui = workspace(catalog({ setup_progress: { catalog_known: true, streams, elapsed_ms: 200000, complete: false }, tasks: [] }));
  const html = ui.page('Background tasks');
  assert.equal((html.match(/role="tab"/g) || []).length, 3);
  assert.match(html, /600 \/ 1200 items complete/);
  assert.match(html, /value="50"/);
  assert.match(html, /Elapsed 2m 3s/);
  assert.match(html, /Other tasks/);
  ui.dispatch('click', { setupStream: 'resource' });
  assert.match(ui.html(), /id="setup-tab-resource"[^>]+aria-selected="true"/);
  assert.match(ui.html(), /School Notes total progress|resource total progress/);
  assert.match(native, /\.put\("setup_progress",SetupProgress\(this@HubActivity\)\.snapshot\(\)\)/);
});

test('native storage guards enrollment and student changes and stores only references', () => {
  assert.match(store, /getSharedPreferences\("student-hub", Context.MODE_PRIVATE\)/);
  assert.match(store, /previous\.optString\("student_id"\)!=value\.optString\("student_id"\)/);
  assert.match(store, /remove\("favorites"\)\.remove\("pinned_keys"\)/);
  assert.match(store, /enrollmentBinding\(\)!=boundEnrollment/);
  assert.match(store, /enrollmentBinding\(\)==boundEnrollment/);
  const methods = store.slice(store.indexOf('fun favoriteKeys()'), store.indexOf('fun saveMessage('));
  assert.doesNotMatch(methods, /\.delete\(|copyTo\(|renameTo\(/);
  assert.match(methods, /check\(prefs\.edit\(\)\.putString/);
});
