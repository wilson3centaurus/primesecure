import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function load(path, require) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('module', 'exports', 'require', source)(module, module.exports, require);
  return module.exports;
}
const errors = load('../src/lib/sign-in-error.ts');
async function attempt(result, thrown = false) {
  const calls = [];
  const actions = load('../src/app/login/actions.ts', (name) => {
    if (name === 'next/navigation') return { redirect: (url) => { throw new Error('REDIRECT:' + url); } };
    if (name === '@/lib/sign-in-error') return errors;
    if (name === '@/lib/supabase/server') return { createClient: async () => ({ auth: {
      signInWithPassword: async (credentials) => {
        calls.push(credentials);
        if (thrown) throw new TypeError('fetch failed');
        return result;
      },
    } }) };
    throw new Error('Unexpected import ' + name);
  });
  const form = new FormData();
  form.set('email', ' admin@example.test ');
  form.set('password', 'not-a-real-password');
  return { response: await actions.signIn(undefined, form), calls };
}
test('rejected credentials retain the credential error', async () => {
  const { response, calls } = await attempt({ error: { status: 400, code: 'invalid_credentials' } });
  assert.equal(response.error, 'Wrong email or password.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].email, 'admin@example.test');
});
test('offline, gateway, and thrown transport failures describe service availability', async () => {
  for (const status of [0, 502, 503, 504]) {
    const { response, calls } = await attempt({ error: { status } });
    assert.match(response.error, /temporarily unavailable/);
    assert.equal(calls.length, 1);
  }
  assert.match((await attempt(null, true)).response.error, /temporarily unavailable/);
});
test('rate limits and unconfirmed email have specific messages', async () => {
  assert.match((await attempt({ error: { status: 429 } })).response.error, /wait a few minutes/);
  assert.match((await attempt({ error: { code: 'email_not_confirmed' } })).response.error, /confirm your email/);
});
test('successful login redirects outside the error catch', async () => {
  await assert.rejects(attempt({ error: null }), /REDIRECT:\/overview/);
});
