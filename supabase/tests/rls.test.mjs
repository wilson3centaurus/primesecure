// Runs every migration against an in-process Postgres (PGlite) with a minimal
// stand-in for Supabase's auth/storage schemas, then checks the school
// isolation rules from each role's point of view.
//
//   cd supabase/tests && npm install && npm test

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// Just enough of what a Supabase database ships with for the migrations to run.
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant all on storage.objects to authenticated, service_role;

  create publication supabase_realtime;
`;

const db = new PGlite();
const ids = {};

// Run SQL as a signed-in user (or anon when uid is null), like PostgREST does.
async function as(uid, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query(`set local role ${uid ? "authenticated" : "anon"}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ""]);
    await tx.query(
      `select set_config('request.headers', '{"x-forwarded-for": "41.57.10.20, 10.0.0.1"}', true)`,
    );
    return (await tx.query(sql, params)).rows;
  });
}

async function rejects(promise, pattern = /row-level security|permission denied|not an enrolled/) {
  await assert.rejects(promise, pattern);
}

before(async () => {
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }

  const user = async (key) => {
    ids[key] = (await db.query(`insert into auth.users (email) values ($1) returning id`, [`${key}@t`])).rows[0].id;
  };
  for (const k of ["super", "adminA", "teacherA", "adminB", "devA", "devB", "stray"]) await user(k);

  ids.schoolA = (await db.query(`insert into schools (name) values ('Rusununguko') returning id`)).rows[0].id;
  ids.schoolB = (await db.query(`insert into schools (name) values ('Melfort') returning id`)).rows[0].id;

  await db.query(
    `insert into profiles (id, school_id, role) values
       ($1, null, 'super_admin'), ($2, $5, 'school_admin'), ($3, $5, 'teacher'), ($4, $6, 'school_admin')`,
    [ids.super, ids.adminA, ids.teacherA, ids.adminB, ids.schoolA, ids.schoolB],
  );

  const device = async (key, school, authUser) => {
    ids[key] = (
      await db.query(
        `insert into devices (school_id, student_name, auth_user_id) values ($1, $2, $3) returning id`,
        [school, key, authUser],
      )
    ).rows[0].id;
  };
  await device("deviceA", ids.schoolA, ids.devA);
  await device("deviceB", ids.schoolB, ids.devB);
  await device("deviceA2", ids.schoolA, null);
});

test("enroll tokens are short Crockford base32 and unique", async () => {
  const rows = (await db.query(`select enroll_token from devices`)).rows;
  for (const { enroll_token } of rows) assert.match(enroll_token, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(new Set(rows.map((r) => r.enroll_token)).size, rows.length);
});

test("anon sees nothing and cannot call device RPCs", async () => {
  await rejects(as(null, `select * from devices`));
  await rejects(as(null, `select device_check_in('{}')`));
});

test("super_admin sees every school", async () => {
  assert.equal((await as(ids.super, `select * from schools`)).length, 2);
  assert.equal((await as(ids.super, `select * from devices`)).length, 3);
});

test("school_admin and teacher are confined to their school", async () => {
  for (const who of ["adminA", "teacherA"]) {
    const schools = await as(ids[who], `select id from schools`);
    assert.deepEqual(schools.map((s) => s.id), [ids.schoolA]);
    const devices = await as(ids[who], `select id from devices order by student_name`);
    assert.deepEqual(devices.map((d) => d.id), [ids.deviceA, ids.deviceA2]);
  }
  assert.deepEqual((await as(ids.adminB, `select id from devices`)).map((d) => d.id), [ids.deviceB]);
});

test("a user without a profile sees nothing", async () => {
  assert.equal((await as(ids.stray, `select * from devices`)).length, 0);
  assert.equal((await as(ids.stray, `select * from schools`)).length, 0);
});

test("school_admin manages devices only in their own school", async () => {
  const [d] = await as(ids.adminA, `insert into devices (school_id, student_name) values ($1, 'New kid') returning status`, [ids.schoolA]);
  assert.equal(d.status, "pending");
  await rejects(as(ids.adminA, `insert into devices (school_id) values ($1)`, [ids.schoolB]));

  const moved = await as(ids.adminA, `update devices set student_name = 'x' where id = $1 returning id`, [ids.deviceB]);
  assert.equal(moved.length, 0);
  await rejects(as(ids.adminA, `update devices set school_id = $1 where id = $2`, [ids.schoolB, ids.deviceA]));
});

test("staff cannot overwrite agent-reported fields or hijack a device account", async () => {
  await rejects(as(ids.adminA, `update devices set auth_user_id = $1 where id = $2`, [ids.adminA, ids.deviceA2]));
  await rejects(as(ids.adminA, `update devices set last_seen_at = now() where id = $1`, [ids.deviceA]));
  await rejects(as(ids.adminA, `insert into devices (school_id, auth_user_id) values ($1, $2)`, [ids.schoolA, ids.stray]));
});

test("teacher is read-only on devices and policies", async () => {
  const updated = await as(ids.teacherA, `update devices set student_name = 'x' where id = $1 returning id`, [ids.deviceA]);
  assert.equal(updated.length, 0);
  await rejects(as(ids.teacherA, `insert into policies (school_id) values ($1)`, [ids.schoolA]));
});

test("teacher may send messages but no other command", async () => {
  const [c] = await as(
    ids.teacherA,
    `insert into commands (device_id, type, payload) values ($1, 'message', '{"text":"Hi"}') returning school_id, created_by`,
    [ids.deviceA],
  );
  assert.equal(c.school_id, ids.schoolA);
  assert.equal(c.created_by, ids.teacherA);
  await rejects(as(ids.teacherA, `insert into commands (device_id, type) values ($1, 'lock')`, [ids.deviceA]));
  await rejects(as(ids.teacherA, `insert into commands (device_id, type) values ($1, 'message')`, [ids.deviceB]));
});

test("commands can't be filed under another school via a forged school_id", async () => {
  const [c] = await as(
    ids.adminA,
    `insert into commands (device_id, school_id, type) values ($1, $2, 'lock') returning school_id`,
    [ids.deviceA, ids.schoolB],
  );
  assert.equal(c.school_id, ids.schoolA);
  await rejects(as(ids.adminA, `insert into commands (device_id, school_id, type) values ($1, $2, 'lock')`, [ids.deviceB, ids.schoolA]));
});

test("school_admin cannot create or promote to super_admin, nor change own role", async () => {
  await rejects(as(ids.adminA, `insert into profiles (id, school_id, role) values ($1, $2, 'teacher')`, [ids.stray, ids.schoolA]));
  await rejects(as(ids.adminA, `update profiles set role = 'super_admin' where id = $1`, [ids.teacherA]));
  const self = await as(ids.adminA, `update profiles set role = 'teacher' where id = $1 returning id`, [ids.adminA]);
  assert.equal(self.length, 0);
  const promoted = await as(ids.adminA, `update profiles set role = 'school_admin' where id = $1 returning role`, [ids.teacherA]);
  assert.equal(promoted[0].role, "school_admin");
  await db.query(`update profiles set role = 'teacher' where id = $1`, [ids.teacherA]);
});

test("device sees only itself and its own commands", async () => {
  assert.deepEqual((await as(ids.devA, `select id from devices`)).map((d) => d.id), [ids.deviceA]);
  assert.equal((await as(ids.devA, `select * from schools`)).length, 0);
  const cmds = await as(ids.devA, `select device_id from commands`);
  assert.ok(cmds.length > 0 && cmds.every((c) => c.device_id === ids.deviceA));
  assert.equal((await as(ids.devB, `select * from commands`)).length, 0);
  await rejects(as(ids.devA, `insert into commands (device_id, type) values ($1, 'unlock')`, [ids.deviceA]));
  const changed = await as(ids.devA, `update devices set status = 'active' where id = $1 returning id`, [ids.deviceA]);
  assert.equal(changed.length, 0);
});

test("device_check_in records the heartbeat and returns the effective policy", async () => {
  const [{ device_check_in: r1 }] = await as(
    ids.devA,
    `select device_check_in($1)`,
    [{ model: "Primebook 4G", battery_level: 81, battery_charging: true, agent_version: "0.1.0" }],
  );
  assert.equal(r1.device_id, ids.deviceA);
  assert.equal(r1.status, "active"); // pending -> active on first check-in
  assert.deepEqual(r1.policy, {});

  const [row] = (await db.query(`select model, battery_level, host(last_ip) ip, last_seen_at from devices where id = $1`, [ids.deviceA])).rows;
  assert.equal(row.model, "Primebook 4G");
  assert.equal(row.battery_level, 81);
  assert.equal(row.ip, "41.57.10.20");
  assert.ok(row.last_seen_at);

  await as(ids.adminA, `insert into policies (school_id, lock_wallpaper, hidden_apps) values ($1, true, '{com.android.chrome}')`, [ids.schoolA]);
  const [{ device_check_in: r2 }] = await as(ids.devA, `select device_check_in()`);
  assert.equal(r2.policy.scope, "school");
  assert.equal(r2.policy.lock_wallpaper, true);
  assert.deepEqual(r2.policy.hidden_apps, ["com.android.chrome"]);

  await as(ids.adminA, `insert into policies (school_id, device_id, block_installs) values ($1, $2, true)`, [ids.schoolA, ids.deviceA]);
  const [{ device_check_in: r3 }] = await as(ids.devA, `select device_check_in()`);
  assert.equal(r3.policy.scope, "device");
  assert.equal(r3.policy.block_installs, true);
  assert.equal(r3.policy.lock_wallpaper, false);

  // The other school's device is unaffected and can't read school A's policy.
  const [{ device_check_in: rb }] = await as(ids.devB, `select device_check_in()`);
  assert.deepEqual(rb.policy, {});
  assert.equal((await as(ids.devB, `select * from policies`)).length, 0);
});

test("non-device accounts can't check in", async () => {
  await rejects(as(ids.adminA, `select device_check_in()`));
  await rejects(as(ids.stray, `select device_check_in()`));
});

test("device_ack_command only touches the device's own commands", async () => {
  const [cmd] = await as(ids.adminA, `insert into commands (device_id, type) values ($1, 'locate') returning id`, [ids.deviceA]);
  await rejects(as(ids.devB, `select device_ack_command($1, 'succeeded')`, [cmd.id]), /command not found/);
  await as(ids.devA, `select device_ack_command($1, 'delivered')`, [cmd.id]);
  await as(ids.devA, `select device_ack_command($1, 'succeeded', '{"ok":true}')`, [cmd.id]);
  const [row] = (await db.query(`select status, result, delivered_at, executed_at from commands where id = $1`, [cmd.id])).rows;
  assert.equal(row.status, "succeeded");
  assert.deepEqual(row.result, { ok: true });
  assert.ok(row.delivered_at && row.executed_at);
  await rejects(as(ids.devA, `select device_ack_command($1, 'failed')`, [cmd.id]), /already finished/);
});

test("device_fetch_commands delivers only the device's own unfinished commands, oldest first", async () => {
  const insert = (device, type, minutesAgo) =>
    db.query(
      `insert into commands (device_id, type, payload, created_at)
       values ($1, $2, '{"n":1}', now() - make_interval(mins => $3)) returning id`,
      [device, type, minutesAgo],
    ).then((r) => r.rows[0].id);
  const newer = await insert(ids.deviceA, "message", 1);
  const older = await insert(ids.deviceA, "locate", 5);
  const done = await insert(ids.deviceA, "message", 10);
  await db.query(`update commands set status = 'succeeded' where id = $1`, [done]);
  const other = await insert(ids.deviceB, "message", 1);

  const [{ r }] = await as(ids.devA, `select device_fetch_commands() as r`);
  const fetched = r.commands.map((c) => c.id);
  assert.ok(fetched.indexOf(older) < fetched.indexOf(newer), "oldest first");
  assert.ok(!fetched.includes(done) && !fetched.includes(other));

  const states = (await db.query(`select id, status, delivered_at from commands where id = any($1)`, [[older, newer, other]])).rows;
  for (const row of states) {
    if (row.id === other) assert.equal(row.status, "pending");
    else assert.ok(row.status === "delivered" && row.delivered_at);
  }

  // Unfinished deliveries are handed out again until acked.
  const [{ r: again }] = await as(ids.devA, `select device_fetch_commands() as r`);
  assert.ok(again.commands.some((c) => c.id === older));

  await rejects(as(ids.adminA, `select device_fetch_commands()`));
  await rejects(as(null, `select device_fetch_commands()`));
});

test("status changes are stamped and the lock message reaches the device", async () => {
  await as(ids.adminA, `update devices set status = 'locked', status_message = 'Bring it to the office' where id = $1`, [ids.deviceA]);
  const [row] = await db.query(`select status_changed_at, status_changed_by from devices where id = $1`, [ids.deviceA]).then((r) => r.rows);
  assert.ok(row.status_changed_at);
  assert.equal(row.status_changed_by, ids.adminA);

  const [{ r }] = await as(ids.devA, `select device_check_in('{}') as r`);
  assert.equal(r.status, "locked");
  assert.equal(r.status_message, "Bring it to the office");

  // Teachers can't lock devices; staff can't forge the audit columns.
  await as(ids.teacherA, `update devices set status = 'suspended' where id = $1`, [ids.deviceA]);
  assert.equal((await db.query(`select status from devices where id = $1`, [ids.deviceA])).rows[0].status, "locked");
  await rejects(as(ids.adminA, `update devices set status_changed_by = $1 where id = $2`, [ids.adminB, ids.deviceA]));

  await db.query(`update devices set status = 'active', status_message = null where id = $1`, [ids.deviceA]);
});

test("storage objects are scoped by the school id path prefix", async () => {
  await db.query(
    `insert into storage.objects (bucket_id, name) values ('apks', $1), ('apks', $2), ('apks', 'junk/no-school.apk')`,
    [`${ids.schoolA}/app.apk`, `${ids.schoolB}/app.apk`],
  );
  const seen = async (uid) => (await as(uid, `select name from storage.objects order by name`)).map((o) => o.name.split("/")[0]);
  assert.deepEqual(await seen(ids.teacherA), [ids.schoolA]);
  assert.deepEqual(await seen(ids.devA), [ids.schoolA]);
  assert.deepEqual(await seen(ids.devB), [ids.schoolB]);
  assert.equal((await seen(ids.super)).length, 3); // super_admin sees every object, prefixed or not

  await as(ids.adminA, `insert into storage.objects (bucket_id, name) values ('media', $1)`, [`${ids.schoolA}/notes.pdf`]);
  await rejects(as(ids.adminA, `insert into storage.objects (bucket_id, name) values ('media', $1)`, [`${ids.schoolB}/x.pdf`]));
  await rejects(as(ids.teacherA, `insert into storage.objects (bucket_id, name) values ('media', $1)`, [`${ids.schoolA}/x.pdf`]));
});

test("realtime publication carries devices, commands and policies", async () => {
  const rows = (await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`)).rows;
  assert.deepEqual(rows.map((r) => r.tablename), ["commands", "devices", "policies"]);
});
