import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
const testDirectory = path.dirname(fileURLToPath(import.meta.url));

// Execute the actual server modules with isolated session/database boundaries.
// No production environment, credentials, database or auth mutations are used.
function load(relative, imports, environment = {}) {
  const source = fs.readFileSync(path.join(testDirectory, '..', relative), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const targetModule = { exports: {} };
  const scopedRequire = name => {
    if (name in imports) return imports[name];
    if (name === 'react/jsx-runtime') return jsxRuntime;
    throw new Error(`Unexpected import: ${name}`);
  };
  new Function('require', 'module', 'exports', 'process', js)(scopedRequire, targetModule, targetModule.exports, { env: environment });
  return targetModule.exports;
}
const school = { id: 'school-a', name: 'QA School' };
test('package blocking accepts unique IDs and rejects wildcards, labels and oversized lists',()=>{
 const {parseBlockedPackages}=load('src/lib/package-rules.ts',{});
 assert.deepEqual(parseBlockedPackages('com.example.app\norg.school.quiz,com.example.app',['com.floydwiz.browser']),['com.floydwiz.browser','com.example.app','org.school.quiz']);
 for(const text of ['Google Chrome','com.*','https://example.test','com.foo;rm -rf','com..app'])assert.throws(()=>parseBlockedPackages(text,[]));
 assert.throws(()=>parseBlockedPackages(Array.from({length:101},(_,n)=>'com.app'+n).join('\n'),[]));
});
const owner = { id: 'owner', email: 'verified@example.test', role: 'school_admin', schoolId: school.id, fullName: 'QA Admin' };
const teacher = { id: 'other', role: 'teacher', school_id: school.id, full_name: 'QA Teacher' };
const form = fields => { const result = new FormData(); for (const [key, value] of Object.entries(fields)) result.set(key, value); return result; };

function setup(options = {}) {
  const events = [];
  const staff = options.staff || owner;
  const target = options.target || teacher;
  const people = options.people || [{ ...owner, school_id: school.id, full_name: owner.fullName }, teacher];
  const client = { from(table) {
    let mutation = false;
    const query = {
      select() { return query; }, eq() { return query; }, order() { return query; },
      maybeSingle: async () => ({ data: table === 'devices' ? { id: 'device', school_id: school.id, auth_user_id: options.deviceAuth === undefined ? 'device-user' : options.deviceAuth } : target }),
      delete() { mutation = true; events.push(`${table}.delete`); return query; },
      update() { mutation = true; events.push(`${table}.update`); return query; },
      insert() { mutation = true; events.push(`${table}.insert`); return query; },
      then(resolve, reject) { return Promise.resolve(mutation ? { data: [{ id: target.id }], error: options.databaseError || null } : { data: people }).then(resolve, reject); },
    };
    return query;
  } };
  const admin = { auth: { admin: {
    createUser: async () => { events.push('auth.create'); return { data: { user: { id: 'new-user' } } }; },
    updateUserById: async () => { events.push('auth.update'); return {}; },
    deleteUser: async () => { events.push('auth.delete'); return { error: options.authError || null }; },
    getUserById: async id => { events.push('auth.lookup'); if (options.lookupThrows) throw Error('Unavailable'); return options.lookupError ? { data: {}, error: { message: 'Unavailable' } } : { data: { user: { email: `${id}@example.test` } } }; },
  } } };
  const imports = {
    'next/cache': { revalidatePath: () => events.push('revalidate') },
    'next/navigation': { redirect: () => { throw Error('TEST_REDIRECT'); } },
    '@/lib/auth': { requireStaff: async () => staff, getCurrentSchool: async () => school, canManage: (user, id) => user.role === 'super_admin' || (user.role === 'school_admin' && user.schoolId === id), ROLE_LABEL: { school_admin: 'School admin', teacher: 'Teacher' } },
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/supabase/admin': { hasAdminConfig: () => !!options.configured, createAdminClient: () => { events.push('admin.client'); assert(options.configured, 'Unconfigured admin client must never be constructed'); return admin; } },
  };
  return { events, imports, staffActions: () => load('src/app/(app)/staff/actions.ts', imports), deviceActions: () => load('src/app/(app)/devices/actions.ts', imports) };
}
const mutationEvents = events => events.filter(event => /\.(delete|update|insert)$/.test(event) || /^auth\.(create|update|delete)$/.test(event));

test('server config helper exposes only a boolean and treats whitespace as missing', () => {
  const imports = { 'server-only': {}, '@supabase/supabase-js': { createClient: () => ({}) }, '@/lib/env': { SUPABASE_URL: 'https://example.test' } };
  for (const value of [undefined, '', '  ']) {
    const api = load('src/lib/supabase/admin.ts', imports, { SUPABASE_SERVICE_ROLE_KEY: value });
    assert.equal(api.hasAdminConfig(), false);
    assert.throws(api.createAdminClient, /not set/);
    assert.deepEqual(Object.keys(api).sort(), ['createAdminClient', 'hasAdminConfig']);
  }
  assert.equal(load('src/lib/supabase/admin.ts', imports, { SUPABASE_SERVICE_ROLE_KEY: 'isolated-fixture-value' }).hasAdminConfig(), true);
});

for (const [name, fields] of [
  ['addStaff', { full_name: 'New Teacher', email: 'new@example.test', password: 'testing123', role: 'teacher' }],
  ['resetPassword', { id: teacher.id, password: 'testing123' }],
  ['removeStaff', { id: teacher.id }],
]) test(`${name}: missing configuration returns an error before any mutation`, async () => {
  const state = setup();
  const result = await state.staffActions()[name](undefined, form(fields));
  assert.match(result.error, /unavailable/);
  assert.deepEqual(mutationEvents(state.events), []);
  assert(!state.events.includes('admin.client'));
});

test('role changes still use RLS when login administration is unavailable', async () => {
  const state = setup();
  assert.equal((await state.staffActions().changeRole(undefined, form({ id: teacher.id, role: 'school_admin' }))).ok, 'Role updated.');
  assert.deepEqual(mutationEvents(state.events), ['profiles.update']);
});

for (const target of [{ ...teacher, id: owner.id }, { ...teacher, school_id: 'other-school' }, { ...teacher, role: 'super_admin' }]) {
  test(`staff authorization stays enforced for ${target.id}/${target.school_id}/${target.role}`, async () => {
    const state = setup({ configured: true, target });
    assert.match((await state.staffActions().removeStaff(undefined, form({ id: target.id }))).error, /can't remove/);
    assert.deepEqual(mutationEvents(state.events), []);
    assert(!state.events.includes('admin.client'));
  });
}

test('teachers cannot add staff even if login administration is configured', async () => {
  const state = setup({ configured: true, staff: { ...owner, role: 'teacher' } });
  assert.match((await state.staffActions().addStaff(undefined, form({ full_name: 'New', email: 'new@example.test', password: 'testing123', role: 'teacher' }))).error, /can't add/);
  assert.deepEqual(mutationEvents(state.events), []);
});

test('configured staff removal respects a database denial before deleting a login', async () => {
  const state = setup({ configured: true, databaseError: { message: 'RLS denied' } });
  assert.equal((await state.staffActions().removeStaff(undefined, form({ id: teacher.id }))).error, 'RLS denied');
  assert(!state.events.includes('auth.delete'));
});

test('configured staff removal resolves configuration before deleting and reports auth failure', async () => {
  const state = setup({ configured: true, authError: { message: 'Offline' } });
  const result = await state.staffActions().removeStaff(undefined, form({ id: teacher.id }));
  assert(state.events.indexOf('admin.client') < state.events.indexOf('profiles.delete'));
  assert.match(result.error, /login could not be deleted/);
  assert.equal(result.ok, undefined);
});

test('enrolled device cannot be deleted without login administration', async () => {
  const state = setup();
  assert.match((await state.deviceActions().deleteDevice(undefined, form({ id: 'device' }))).error, /has not been deleted/);
  assert.deepEqual(mutationEvents(state.events), []);
});

test('unenrolled device without an auth account can still be deleted without the key', async () => {
  const state = setup({ deviceAuth: null });
  await assert.rejects(state.deviceActions().deleteDevice(undefined, form({ id: 'device' })), /TEST_REDIRECT/);
  assert.deepEqual(mutationEvents(state.events), ['devices.delete']);
  assert(!state.events.includes('admin.client'));
});

test('unauthorized device deletion does not reach configuration or mutation', async () => {
  const state = setup({ configured: true, staff: { ...owner, schoolId: 'other-school' } });
  assert.match((await state.deviceActions().deleteDevice(undefined, form({ id: 'device' }))).error, /can't delete/);
  assert.deepEqual(mutationEvents(state.events), []);
  assert(!state.events.includes('admin.client'));
});

test('configured device removal reports incomplete login cleanup', async () => {
  const state = setup({ configured: true, authError: { message: 'Offline' } });
  assert.match((await state.deviceActions().deleteDevice(undefined, form({ id: 'device' }))).error, /login could not be removed/);
  assert(state.events.indexOf('admin.client') < state.events.indexOf('devices.delete'));
});

async function pageHtml(options) {
  const state = setup(options);
  const Page = load('src/app/(app)/staff/page.tsx', { ...state.imports,
    '@/components/page-header': { PageHeader: ({ title }) => React.createElement('h1', null, title) },
    './forms': { AddStaffForm: () => React.createElement('button', null, 'Add staff'), StaffActions: ({ loginManagement }) => React.createElement('div', null, 'Role picker', loginManagement && 'Reset password / Remove') },
    'lucide-react': { Info: () => React.createElement('svg') },
  }).default;
  return { html: renderToStaticMarkup(await Page()), events: state.events };
}

test('Staff renders its RLS roster and verified own email with no admin config', async () => {
  const { html, events } = await pageHtml({ configured: false });
  assert.match(html, /<h1>Staff<\/h1>/);
  assert.match(html, /QA Teacher/);
  assert.match(html, /verified@example.test/);
  assert.match(html, /Email unavailable/);
  assert.match(html, /Role picker/);
  assert(!html.includes('Add staff'));
  assert(!html.includes('Reset password / Remove'));
  assert(!events.includes('admin.client'));
});

for (const failure of ['lookupError', 'lookupThrows']) test(`Staff roster survives ${failure} with configured login management`, async () => {
  const { html } = await pageHtml({ configured: true, [failure]: true });
  assert.match(html, /QA Teacher/);
  assert.match(html, /verified@example.test/);
  assert.match(html, /Some staff email addresses are unavailable/);
});

test('StaffActions hides only login-specific actions when configuration is unavailable', () => {
  const Forms = load('src/app/(app)/staff/forms.tsx', {
    react: { ...React, useActionState: () => [undefined, () => {}], useState: () => [false, () => {}] },
    './actions': {}, '@/components/form-message': { FormMessage: () => null },
    '@/components/submit-button': { SubmitButton: ({ children }) => React.createElement('button', null, children) },
  });
  const missing = renderToStaticMarkup(Forms.StaffActions({ id: teacher.id, role: 'teacher', loginManagement: false }));
  assert.match(missing, /<select/);
  assert(!missing.includes('Reset password'));
  assert(!missing.includes('>Remove<'));
  const configured = renderToStaticMarkup(Forms.StaffActions({ id: teacher.id, role: 'teacher', loginManagement: true }));
  assert.match(configured, /Reset password/);
  assert.match(configured, />Remove</);
});
