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

test("app library is per school and admin-managed", async () => {
  const path = `${ids.schoolA}/x.apk`;
  await as(ids.adminA, `insert into apps (school_id, name, storage_path) values ($1, 'Kolibri', $2)`, [ids.schoolA, path]);
  await rejects(as(ids.teacherA, `insert into apps (school_id, name, storage_path) values ($1, 'X', $2)`, [ids.schoolA, path]));
  await rejects(as(ids.adminB, `insert into apps (school_id, name, storage_path) values ($1, 'X', $2)`, [ids.schoolA, path]));
  // The object path must live under the row's own school.
  await assert.rejects(as(ids.adminA, `insert into apps (school_id, name, storage_path) values ($1, 'X', $2)`, [ids.schoolA, `${ids.schoolB}/x.apk`]), /check constraint/);
  assert.equal((await as(ids.teacherA, `select * from apps`)).length, 1);
  assert.equal((await as(ids.adminB, `select * from apps`)).length, 0);
});

test("check-in stores the reported app list only when sent", async () => {
  const apps = [{ package: "org.learningequality.Kolibri", label: "Kolibri", version: "0.17", system: false }];
  const [{ r }] = await as(ids.devA, `select device_check_in($1) as r`, [JSON.stringify({ apps })]);
  assert.equal(r.apps_known, true);
  await as(ids.devA, `select device_check_in('{}')`);
  const [row] = (await db.query(`select installed_apps, apps_reported_at from devices where id = $1`, [ids.deviceA])).rows;
  assert.deepEqual(row.installed_apps, apps);
  assert.ok(row.apps_reported_at);
  await rejects(as(ids.adminA, `update devices set installed_apps = '[]' where id = $1`, [ids.deviceA]));
});

test("devices report their own location; staff of the school read it", async () => {
  await as(ids.devA, `select device_report_location(-17.83, 31.05, 1200, 'network')`);
  const rows = await as(ids.teacherA, `select device_id, school_id, source from locations`);
  assert.deepEqual(rows, [{ device_id: ids.deviceA, school_id: ids.schoolA, source: "network" }]);
  assert.equal((await as(ids.adminB, `select * from locations`)).length, 0);
  await rejects(as(ids.adminA, `select device_report_location(0, 0)`));
  await rejects(as(ids.adminA, `insert into locations (device_id, lat, lng) values ($1, 0, 0)`, [ids.deviceA]));
  await assert.rejects(as(ids.devA, `select device_report_location(0, 0, null, 'teleport')`), /check constraint/);
});

test("web filter settings reach the device through its policy", async () => {
  await as(ids.adminB, `insert into policies (school_id, web_filter, web_blocklist, safe_search, browser_home_url)
                        values ($1, 'blocklist', '{tiktok.com}', true, 'https://kolibri.school')`, [ids.schoolB]);
  const [{ r }] = await as(ids.devB, `select device_check_in('{}') as r`);
  assert.equal(r.policy.web_filter, "blocklist");
  assert.deepEqual(r.policy.web_blocklist, ["tiktok.com"]);
  assert.equal(r.policy.safe_search, true);
  assert.equal(r.policy.browser_home_url, "https://kolibri.school");
  await assert.rejects(as(ids.adminB, `update policies set web_filter = 'everything' where school_id = $1`, [ids.schoolB]), /check constraint/);
  await db.query(`delete from policies where school_id = $1`, [ids.schoolB]);
});

test("list_files is an admin command", async () => {
  await as(ids.adminA, `insert into commands (device_id, type, payload) values ($1, 'list_files', '{"path":""}')`, [ids.deviceA]);
  await rejects(as(ids.teacherA, `insert into commands (device_id, type) values ($1, 'list_files')`, [ids.deviceA]));
});

test("agent releases: super_admin publishes, devices are offered newer active builds", async () => {
  await rejects(as(ids.adminA, `insert into agent_releases (version_code, version_name, storage_path) values (5, '0.5', 'x.apk')`));
  await as(ids.super, `insert into agent_releases (version_code, version_name, storage_path) values (5, '0.5', 'a5.apk'), (7, '0.7', 'a7.apk')`);
  await as(ids.super, `insert into agent_releases (version_code, version_name, storage_path, active) values (9, '0.9', 'a9.apk', false)`);

  const offer = async (code) => (await as(ids.devA, `select device_check_in($1) as r`, [JSON.stringify({ agent_version_code: code })]))[0].r.agent_update;
  assert.equal((await offer(3)).version_code, 7, "newest active release");
  assert.equal(await offer(7), null, "already current");
  assert.equal((await as(ids.devA, `select device_check_in('{}') as r`))[0].r.agent_update, null, "old agents that don't report a code get nothing");
  assert.equal((await db.query(`select agent_version_code from devices where id = $1`, [ids.deviceA])).rows[0].agent_version_code, 7);

  assert.equal((await as(ids.teacherA, `select * from agent_releases`)).length, 3);
  assert.equal((await as(ids.devA, `select * from agent_releases`)).length, 0, "devices learn about releases only via check-in");
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
  assert.deepEqual(rows.map((r) => r.tablename), ["commands", "devices", "hub_access", "hub_items", "hub_settings", "policies", "support_messages"]);
});

test("student hub isolates private resources and requires school opt-in for shared content", async () => {
  await db.query(`update devices set status='active' where id in ($1,$2)`, [ids.deviceA,ids.deviceB]);
  const add = async (school, path) => (await db.query(`insert into hub_items(school_id,kind,title,storage_path,size) values($1,'resource','Math notes',$2,100) returning id`, [school,path])).rows[0].id;
  const local = await add(ids.schoolA, `${ids.schoolA}/notes.pdf`);
  const shared = await add(null, "shared/notes.pdf");
  assert.equal((await as(ids.devA, `select * from hub_items where id=$1`,[local])).length,1);
  assert.equal((await as(ids.devB, `select * from hub_items where id=$1`,[local])).length,0);
  assert.equal((await as(ids.devA, `select * from hub_items where id=$1`,[shared])).length,0);
  await as(ids.adminA, `insert into hub_access(item_id,school_id) values($1,$2)`,[shared,ids.schoolA]);
  assert.equal((await as(ids.devA, `select * from hub_items where id=$1`,[shared])).length,1);
  assert.equal((await as(ids.devB, `select * from hub_items where id=$1`,[shared])).length,0);
  await rejects(as(ids.devA, `delete from hub_items where id=$1 returning *`,[local]).then(rows => { if (!rows.length) throw Error('permission denied'); }));
  await rejects(as(ids.teacherA, `insert into hub_items(school_id,kind,title,storage_path,size) values($1,'resource','Forged',$2,10)`,[ids.schoolA,`${ids.schoolA}/forged`]));
  await rejects(as(null, `select device_hub()`));
  await as(ids.adminA, `delete from hub_access where item_id=$1 and school_id=$2`,[shared,ids.schoolA]);
  assert.equal((await as(ids.devA, `select * from hub_items where id=$1`,[shared])).length,0);
});

test("student app installs require catalog approval, are deduplicated, and respect school boundaries", async () => {
  await db.query(`update devices set status='active' where id=$1`, [ids.deviceA]);
  const app = (await db.query(`insert into hub_items(school_id,kind,title,storage_path,size,package_name) values($1,'app','Calculator',$2,100,'school.calc') returning id`,[ids.schoolA,`${ids.schoolA}/calc.apk`])).rows[0].id;
  const first = (await as(ids.devA, `select device_hub_action('install',$1) as result`,[app]))[0].result;
  const second = (await as(ids.devA, `select device_hub_action('install',$1) as result`,[app]))[0].result;
  assert.equal(first.command_id, second.command_id);
  await assert.rejects(as(ids.devB, `select device_hub_action('install',$1)`,[app]), /not available/);
  await db.query(`update hub_items set published=false where id=$1`,[app]);
  await assert.rejects(as(ids.devA, `select device_hub_action('install',$1)`,[app]), /not available/);
  await as(ids.devA, `select device_hub_action('request_app',null,'Geometry','For class')`);
  assert.equal((await as(ids.adminA, `select * from hub_requests where name='Geometry'`)).length,1);
  assert.equal((await as(ids.adminB, `select * from hub_requests where name='Geometry'`)).length,0);
});

test("message acknowledgements are durable, idempotent and device-specific", async () => {
  const id = (await as(ids.teacherA, `insert into commands(device_id,type,payload) values($1,'message','{"body":"Please read","require_ack":true}') returning id`,[ids.deviceA]))[0].id;
  await rejects(as(ids.devB, `select device_ack_message($1)`,[id]), /message not found/);
  await as(ids.devA, `select device_ack_message($1)`,[id]);
  const first = (await db.query(`select acknowledged_at from commands where id=$1`,[id])).rows[0].acknowledged_at;
  await as(ids.devA, `select device_ack_message($1)`,[id]);
  assert.deepEqual((await db.query(`select acknowledged_at from commands where id=$1`,[id])).rows[0].acknowledged_at,first);
  await rejects(as(ids.adminA, `update commands set acknowledged_at=now() where id=$1`,[id]));
  const inbox = (await as(ids.devA, `select device_message_history() as inbox`))[0].inbox.messages;
  assert.ok(inbox.some(m => m.id === id && m.acknowledged_at));
});

test("master wallpapers are downloadable by devices while other shared content stays private", async () => {
  const id = (await db.query(`insert into hub_items(kind,title,storage_path,size) values('wallpaper','Master','shared/master.png',100) returning id`)).rows[0].id;
  await as(ids.super, `insert into hub_settings(scope,default_wallpaper_id) values('global',$1)`,[id]);
  await db.query(`insert into storage.objects(bucket_id,name) values('primesecure-hub','shared/master.png')`);
  assert.equal((await as(ids.devA, `select * from storage.objects where bucket_id='primesecure-hub' and name='shared/master.png'`)).length,1);
  const result = (await as(ids.devA, `select device_hub() as hub`))[0].hub;
  assert.equal(result.wallpaper.id,id);
  await rejects(as(ids.adminA, `update hub_settings set allow_wallpaper_choice=false where scope='global' returning *`).then(rows => { if (!rows.length) throw Error('permission denied'); }));
});

test("battery telemetry is device-owned and cannot be forged by staff", async () => {
  await as(ids.devA, `select device_battery_report('{"health":"good","temperature_c":32.4}')`);
  const result = (await as(ids.adminA, `select battery_diagnostics from devices where id=$1`,[ids.deviceA]))[0].battery_diagnostics;
  assert.equal(result.health,"good"); assert.ok(result.reported_at);
  await rejects(as(ids.adminA, `update devices set battery_diagnostics='{}' where id=$1`,[ids.deviceA]));
});

test('student numbers are generated while existing IDs are preserved',async()=>{
 const rows=await as(ids.adminA,`insert into devices(school_id,student_name,form_level,class_name,gender) values($1,'New learner','Form 2','2B','Female') returning student_id,form_level,class_name`,[ids.schoolA]);
 assert.match(rows[0].student_id,/^PS-\d{4}-\d+$/);assert.equal(rows[0].class_name,'2B');
 await rejects(as(ids.teacherA,`insert into devices(school_id,student_name) values($1,'Denied')`,[ids.schoolA]));
});
test('emergency profiles are private to the device and school administrators',async()=>{
 const profile={dob:'2010-04-20',home_address:'School Road',mother_phone:'0771234567',father_phone:'',personal_phone:''};
 await as(ids.devA,`select device_student_profile($1::jsonb)`,[JSON.stringify(profile)]);
 assert.equal((await as(ids.adminA,'select * from student_records')).length,1);
 assert.equal((await as(ids.teacherA,'select * from student_records')).length,0);
 assert.equal((await as(ids.adminB,'select * from student_records')).length,0);
 assert.equal((await as(ids.devB,'select * from student_records')).length,0);
 const hub=(await as(ids.devA,'select device_hub() value'))[0].value;
 assert.equal(hub.student_profile.home_address,'School Road');assert.equal(hub.school_name,'Rusununguko');
 await rejects(as(ids.stray,`select device_student_profile($1::jsonb)`,[JSON.stringify(profile)]));
 await rejects(as(ids.devA,`update student_records set home_address='forged'`));
});
test('seen receipts are idempotent and cannot be forged for another device',async()=>{
 const cmd=(await as(ids.adminA,`insert into commands(device_id,type,payload) values($1,'message','{"body":"Receipt test"}') returning id`,[ids.deviceA]))[0].id;
 await as(ids.devA,'select device_message_seen($1)',[cmd]);
 const first=(await as(ids.adminA,'select seen_at from commands where id=$1',[cmd]))[0].seen_at;
 await as(ids.devA,'select device_message_seen($1)',[cmd]);
 assert.equal(String((await as(ids.adminA,'select seen_at from commands where id=$1',[cmd]))[0].seen_at),String(first));
 await rejects(as(ids.devB,'select device_message_seen($1)',[cmd]),/message not found/);
 await rejects(as(ids.adminA,'update commands set seen_at=now() where id=$1',[cmd]));
});
test('anonymous-marked replies preserve device identity and school isolation',async()=>{
 const cmd=(await as(ids.adminA,`insert into commands(device_id,type,payload) values($1,'message','{"body":"Reply test"}') returning id`,[ids.deviceA]))[0].id;
 await as(ids.devA,'select device_message_reply($1,$2,true)',[cmd,'I need help']);
 const row=(await as(ids.adminA,'select * from message_replies'))[0];assert.equal(row.device_id,ids.deviceA);assert.equal(row.anonymous,true);
 assert.equal((await as(ids.adminB,'select * from message_replies')).length,0);
 assert.equal((await as(ids.devB,'select * from message_replies')).length,0);
 await rejects(as(ids.devB,'select device_message_reply($1,$2,false)',[cmd,'Forged']),/message not found/);
 await rejects(as(ids.devA,'insert into message_replies(command_id,device_id,school_id,body) values($1,$2,$3,$4)',[cmd,ids.deviceB,ids.schoolA,'Forged']));
});
test('cached files remain school-admin only and reject malformed snapshots',async()=>{
 const snapshot={entries:[{path:'Pictures/test.jpg',name:'test.jpg',parent:'Pictures',dir:false,size:100,modified:1,kind:'image'}],truncated:false};
 await as(ids.devA,'select device_file_snapshot($1::jsonb)',[JSON.stringify(snapshot)]);
 assert.equal((await as(ids.adminA,'select * from device_file_cache')).length,1);
 for(const role of ['teacherA','adminB','devB','stray'])assert.equal((await as(ids[role],'select * from device_file_cache')).length,0);
 await rejects(as(ids.devA,'select device_file_snapshot($1::jsonb)',[JSON.stringify({entries:[{...snapshot.entries[0],path:'../secret'}]})]),/Invalid entry/);
 await rejects(as(ids.devA,'select device_file_snapshot($1::jsonb)',[JSON.stringify({entries:[{}]})]),/Invalid entry/);
 await rejects(as(null,'select device_file_snapshot($1::jsonb)',[JSON.stringify(snapshot)]));
});

test('durable app imports are school-scoped and worker status cannot be forged',async()=>{
 const row=(await as(ids.adminA,`insert into app_imports(school_id,package_id,created_by) values($1,'org.example.app',$2) returning id,status`,[ids.schoolA,ids.adminA]))[0];
 assert.equal(row.status,'queued');
 assert.equal((await as(ids.adminB,'select * from app_imports')).length,0);
 assert.equal((await as(ids.teacherA,'select * from app_imports')).length,0);
 await rejects(as(ids.adminA,'update app_imports set status=\'succeeded\' where id=$1',[row.id]));
 await rejects(as(ids.adminA,`insert into app_imports(school_id,package_id,created_by) values($1,'org.example.foreign',$2)`,[ids.schoolB,ids.adminA]));
 await rejects(as(ids.devA,`insert into app_imports(school_id,package_id,created_by) values($1,'org.example.device',$2)`,[ids.schoolA,ids.adminA]));
 await rejects(as(ids.adminA,`insert into app_imports(school_id,package_id,created_by,status) values($1,'org.example.forged',$2,'succeeded')`,[ids.schoolA,ids.adminA]));
});

test('offline support retries deduplicate and preserve private school conversations',async()=>{
 const request=(await db.query('select gen_random_uuid() id')).rows[0].id,payload=JSON.stringify({body:'Help with a textbook'});
 for(let i=0;i<2;i++)await as(ids.devA,'select device_offline_action($1,\'support\',$2::jsonb)',[request,payload]);
 assert.equal((await as(ids.adminA,'select * from support_messages')).length,1);
 for(const role of ['teacherA','adminB','devB','stray'])assert.equal((await as(ids[role],'select * from support_messages')).length,0);
 await rejects(as(ids.teacherA,'select staff_support_reply($1,$2)',[ids.deviceA,'forged']),/Administrator/);
 await rejects(as(ids.devB,'select staff_support_reply($1,$2)',[ids.deviceA,'forged']),/Administrator/);
 await as(ids.adminA,'select staff_support_reply($1,$2)',[ids.deviceA,'We can help']);
 assert.equal((await as(ids.devA,'select device_hub() value'))[0].value.support_messages.length,2);
 await rejects(as(null,'select device_offline_action($1,\'support\',$2::jsonb)',[request,payload]));
});
test('offline reply retries produce one reply after a lost response',async()=>{
 const cmd=(await as(ids.adminA,`insert into commands(device_id,type,payload) values($1,'message','{"body":"Offline test"}') returning id`,[ids.deviceA]))[0].id;
 const request=(await db.query('select gen_random_uuid() id')).rows[0].id,payload=JSON.stringify({command_id:cmd,body:'Saved offline',anonymous:true});
 for(let i=0;i<2;i++)await as(ids.devA,'select device_offline_action($1,\'reply\',$2::jsonb)',[request,payload]);
 assert.equal((await as(ids.adminA,'select * from message_replies where command_id=$1',[cmd])).length,1);
 await rejects(as(ids.devB,'select device_offline_action(gen_random_uuid(),\'reply\',$1::jsonb)',[payload]),/message not found/);
});
test('offline profile changes preserve school-assigned names and validate avatars',async()=>{
 const profile={dob:'2010-02-04',home_address:'School Road',mother_phone:'0770000000',username:'learner_17',profile_photo:'data:image/jpeg;base64,YQ==',student_name:'Forged name'};
 await as(ids.devA,'select device_offline_action(gen_random_uuid(),\'profile\',$1::jsonb)',[JSON.stringify(profile)]);
 assert.equal((await as(ids.adminA,'select * from student_records where device_id=$1',[ids.deviceA]))[0].username,'learner_17');
 assert.notEqual((await db.query('select student_name from devices where id=$1',[ids.deviceA])).rows[0].student_name,'Forged name');
 await rejects(as(ids.devA,'select device_student_profile($1::jsonb)',[JSON.stringify({...profile,profile_photo:'https://evil.test/x'})]),/smaller profile picture/);
 await rejects(as(ids.devA,'select device_student_profile($1::jsonb)',[JSON.stringify({...profile,username:'<script>'})]),/Username/);
});
test('class lists and runtime diagnostics respect administrator boundaries',async()=>{
 await as(ids.adminA,'insert into school_classes(school_id,form_level,class_name) values($1,\'Form 3\',\'3A\')',[ids.schoolA]);
 assert.equal((await as(ids.teacherA,'select * from school_classes')).length,1);
 assert.equal((await as(ids.adminB,'select * from school_classes')).length,0);
 await rejects(as(ids.teacherA,'insert into school_classes(school_id,form_level) values($1,\'Forged\')',[ids.schoolA]));
 await rejects(as(ids.adminB,'insert into school_classes(school_id,form_level) values($1,\'Forged\')',[ids.schoolA]));
 await as(ids.devA,'select device_runtime_report($1::jsonb)',[JSON.stringify({recovery:'ready',usb:{mounted_drives:1}})]);
 assert.equal((await as(ids.adminA,'select * from device_runtime')).length,1);
 assert.equal((await as(ids.adminB,'select * from device_runtime')).length,0);
 await rejects(as(ids.adminA,'update device_runtime set readings=\'{}\''));
 await rejects(as(ids.adminA,'select device_runtime_report(\'{}\')'));
});
test('recovery commands require admins and redact temporary passwords after acknowledgement',async()=>{
 await rejects(as(ids.teacherA,`insert into commands(device_id,type,payload) values($1,'reset_password','{"password":"Temp4321"}')`,[ids.deviceA]));
 const cmd=(await as(ids.adminA,`insert into commands(device_id,type,payload) values($1,'reset_password','{"password":"Temp4321"}') returning id`,[ids.deviceA]))[0].id;
 assert.equal((await as(ids.teacherA,'select * from commands where id=$1',[cmd])).length,0);
 await as(ids.devA,`select device_ack_command($1,'succeeded','{"reset":true}')`,[cmd]);
 assert.equal((await as(ids.adminA,'select payload from commands where id=$1',[cmd]))[0].payload.password,undefined);
});

test('boot recovery capabilities can only fetch and acknowledge their own password reset',async()=>{
 const secret='a'.repeat(64);
 await as(ids.devA,'select device_register_recovery($1)',[secret]);
 await rejects(as(ids.teacherA,'select device_register_recovery($1)',[secret]));
 await rejects(as(ids.devA,'select * from device_recovery_channels'));
 const cmd=(await as(ids.adminA,`insert into commands(device_id,type,payload) values($1,'reset_password',jsonb_build_object('password','Temp4321','expires_at',now()+interval '30 minutes')) returning id`,[ids.deviceA]))[0].id;
 await rejects(as(null,'select device_recovery_poll($1,$2)',[ids.deviceA,'b'.repeat(64)]),/invalid recovery/);
 await rejects(as(null,'select device_recovery_poll($1,$2)',[ids.deviceB,secret]),/invalid recovery/);
 const result=(await as(null,'select device_recovery_poll($1,$2) value',[ids.deviceA,secret]))[0].value;
 assert.equal(result.commands.length,1);assert.equal(result.commands[0].id,cmd);
 await as(null,'select device_recovery_ack($1,$2,$3,\'succeeded\')',[ids.deviceA,secret,cmd]);
 assert.equal((await as(ids.adminA,'select payload from commands where id=$1',[cmd]))[0].payload.password,undefined);
});


test('message deletion checks ownership and school, preserves receipts and supplies device tombstones',async()=>{
 const own=(await as(ids.teacherA,"insert into commands(device_id,type,payload) values($1,'message','{}') returning id",[ids.deviceA]))[0].id;
 const other=(await as(ids.adminA,"insert into commands(device_id,type,payload) values($1,'message','{}') returning id",[ids.deviceA]))[0].id;
 await as(ids.devA,'select device_ack_message($1)',[own]);
 const ack=(await db.query('select acknowledged_at from commands where id=$1',[own])).rows[0].acknowledged_at;
 await rejects(as(ids.adminB,'select staff_delete_messages($1::uuid[])',[[own]]),/cannot delete/);
 await rejects(as(ids.teacherA,'select staff_delete_messages($1::uuid[])',[[other]]),/cannot delete/);
 await rejects(as(ids.devA,'select staff_delete_messages($1::uuid[])',[[own]]),/Invalid/);
 await rejects(as(null,'select staff_delete_messages($1::uuid[])',[[own]]));
 await rejects(as(ids.adminA,'select staff_delete_messages(null)'),/Invalid/);
 const location=(await as(ids.adminA,"insert into commands(device_id,type) values($1,'locate') returning id",[ids.deviceA]))[0].id;
 await rejects(as(ids.adminA,'select staff_delete_messages($1::uuid[])',[[own,location]]),/cannot delete/);
 assert.equal((await db.query('select deleted_at from commands where id=$1',[own])).rows[0].deleted_at,null);
 await as(ids.teacherA,'select staff_delete_messages($1::uuid[])',[[own]]);
 const row=(await db.query('select status,deleted_at,acknowledged_at from commands where id=$1',[own])).rows[0];
 assert.equal(row.status,'cancelled');assert.ok(row.deleted_at);assert.deepEqual(row.acknowledged_at,ack);
 const inbox=(await as(ids.devA,'select device_message_history() as inbox'))[0].inbox;
 assert.ok(!inbox.messages.some(m=>m.id===own));assert.ok(inbox.deleted_ids.includes(own));assert.ok(inbox.messages.some(m=>m.id===other));
 await rejects(as(ids.devA,"select device_message_reply($1,'Deleted notice')",[own]),/message not found/);
 assert.equal((await as(ids.adminA,'select staff_delete_messages($1::uuid[]) as result',[[own]]))[0].result.deleted,0);
});

test('catalogue app approval overrides stale lists and isolates schools and withdrawn apps',async()=>{
 const app=(await db.query("insert into hub_items(school_id,kind,title,storage_path,size,package_name) values($1,'app','Viewer',$2,200,'org.test.viewer') returning id",[ids.schoolA,ids.schoolA+'/viewer.apk'])).rows[0].id;
 await db.query("insert into hub_settings(scope,school_id,approved_apps_only) values($1,$2,true) on conflict(scope) do update set approved_apps_only=true",[ids.schoolA,ids.schoolA]);
 await db.query("update policies set hidden_apps='{org.test.viewer}',allowed_apps='{org.legacy.only}' where school_id=$1",[ids.schoolA]);
 let hub=(await as(ids.devA,'select device_hub() as hub'))[0].hub;
 assert.equal(hub.management.approved_apps_only,true);assert.ok(hub.management.approved_packages.includes('org.test.viewer'));assert.ok(hub.items.some(i=>i.id===app));
 const other=(await as(ids.devB,'select device_hub() as hub'))[0].hub;assert.ok(!other.management.approved_packages.includes('org.test.viewer'));
 await db.query('update hub_items set published=false where id=$1',[app]);
 hub=(await as(ids.devA,'select device_hub() as hub'))[0].hub;assert.ok(!hub.management.approved_packages.includes('org.test.viewer'));assert.ok(!hub.items.some(i=>i.id===app));
 await rejects(as(ids.devA,"select device_hub_action('install',$1)",[app]),/not available/);
 await db.query('update hub_items set published=true where id=$1',[app]);
 await db.query('update hub_settings set approved_apps_only=false where school_id=$1',[ids.schoolA]);
 hub=(await as(ids.devA,'select device_hub() as hub'))[0].hub;assert.equal(hub.management.approved_apps_only,false);assert.ok(!hub.items.some(i=>i.id===app));
});

test('a 300-device notice has complete receipts and deletes as one broadcast',async()=>{
 const broadcast=(await db.query('select gen_random_uuid() as id')).rows[0].id;
 const payload=JSON.stringify({title:'Fleet test',body:'One notice for 300 devices',broadcast_id:broadcast});
 const devices=(await db.query("insert into devices(school_id,student_name) select $1,'Fleet QA '||n from generate_series(1,300)n returning id",[ids.schoolA])).rows;
 for(const d of devices) await as(ids.adminA,"insert into commands(device_id,type,payload) values($1,'message',$2::jsonb)",[d.id,payload]);
 await rejects(as(ids.adminB,'select staff_message_history($1)',[ids.schoolA]),/staff access/);
 await rejects(as(ids.devA,'select staff_message_history($1)',[ids.schoolA]),/staff access/);
 const history=(await as(ids.adminA,'select staff_message_history($1) as result',[ids.schoolA]))[0].result;
 const notice=history.find(n=>n.title==='Fleet test');assert.equal(notice.receipts.length,300);assert.equal(notice.body,'One notice for 300 devices');
 const result=(await as(ids.adminA,'select staff_delete_messages($1::uuid[]) as result',[[notice.receipts[0].id]]))[0].result;
 assert.equal(result.deleted,300);
 assert.equal((await db.query("select count(*)::int as n from commands where payload->>'broadcast_id'=$1 and deleted_at is not null",[broadcast])).rows[0].n,300);
});

async function diagnosticFixture() {
 const user=(await db.query("insert into auth.users(email) values('diag-'||gen_random_uuid()||'@t') returning id")).rows[0].id;
 const device=(await db.query("insert into devices(school_id,student_name,auth_user_id,status) values($1,'Diagnostics QA',$2,'active') returning id",[ids.schoolA,user])).rows[0].id;
 const event={id:(await db.query('select gen_random_uuid() as id')).rows[0].id,occurred_at:new Date().toISOString(),severity:'error',category:'policy',code:'operation_failed',version:'0.6.5',details:{strict:false}};
 return {user,device,event};
}

test('school changes signal only relevant devices and cannot be forged by device or staff writes',async()=>{
 const f=await diagnosticFixture();
 const other=(await db.query('select sync_revision from devices where id=$1',[ids.deviceB])).rows[0].sync_revision;
 await as(ids.adminA,"insert into hub_settings(scope,school_id) values($1,$2) on conflict(scope) do update set approved_apps_only=not hub_settings.approved_apps_only",[ids.schoolA,ids.schoolA]);
 const state=(await as(f.user,'select device_sync_state() as s'))[0].s;
 assert.ok(state.revision>state.applied_revision);assert.ok(state.topics.includes('settings'));
 assert.equal((await db.query('select sync_revision from devices where id=$1',[ids.deviceB])).rows[0].sync_revision,other);
 await rejects(as(f.user,"select queue_device_sync(null,null,'settings')"));
 await rejects(as(ids.adminA,'update devices set sync_revision=999 where id=$1',[f.device]));
 await rejects(as(null,'select device_sync_state()'));
 await rejects(as(ids.teacherA,'select staff_request_device_sync($1)',[f.device]),/administrator/);
 await rejects(as(ids.adminB,'select staff_request_device_sync($1)',[f.device]),/administrator/);
 await as(ids.adminA,'select staff_request_device_sync($1)',[f.device]);
});

test('sync acknowledgement is monotonic and a newer revision stays pending',async()=>{
 const f=await diagnosticFixture();
 await as(ids.adminA,'select staff_request_device_sync($1)',[f.device]);
 const first=(await as(f.user,'select device_sync_state() as s'))[0].s.revision;
 await as(ids.adminA,'select staff_request_device_sync($1)',[f.device]);
 const oldAck=(await as(f.user,'select device_ack_sync($1) as s',[first]))[0].s;
 assert.equal(oldAck.applied_revision,first);assert.ok(oldAck.revision>oldAck.applied_revision);
 await rejects(as(f.user,'select device_ack_sync($1)',[oldAck.revision+1]),/invalid sync/);
 await rejects(as(ids.adminA,'select device_ack_sync($1)',[first]));
 await as(f.user,'select device_ack_sync($1)',[oldAck.revision]);
 const stale=(await as(f.user,'select device_ack_sync($1) as s',[first]))[0].s;
 assert.equal(stale.applied_revision,oldAck.revision);
 await db.query("update devices set status='retired' where id=$1",[f.device]);
 await rejects(as(f.user,'select device_sync_state()'));
});

test('library additions, removals, school access and device policy changes persist sync hints',async()=>{
 const f=await diagnosticFixture();
 const item=(await as(ids.adminA,"insert into hub_items(school_id,kind,title,storage_path,size) values($1::uuid,'resource','Sync notes',$1::text||'/sync-'||gen_random_uuid()||'.pdf',100) returning id",[ids.schoolA])).at(0).id;
 let state=(await as(f.user,'select device_sync_state() as s'))[0].s;assert.ok(state.topics.includes('notes'));
 await as(f.user,'select device_ack_sync($1)',[state.revision]);
 await as(ids.adminA,'delete from hub_items where id=$1',[item]);
 state=(await as(f.user,'select device_sync_state() as s'))[0].s;assert.ok(state.revision>state.applied_revision);
 const shared=(await as(ids.super,"insert into hub_items(kind,title,storage_path,size) values('resource','Shared sync','shared/'||gen_random_uuid()||'.pdf',100) returning id"))[0].id;
 const before=(await as(f.user,'select device_sync_state() as s'))[0].s.revision;
 await as(ids.super,'insert into hub_access(item_id,school_id) values($1,$2)',[shared,ids.schoolA]);
 assert.ok((await as(f.user,'select device_sync_state() as s'))[0].s.revision>before);
 const accessRevision=(await as(f.user,'select device_sync_state() as s'))[0].s.revision;
 await as(ids.super,'delete from hub_access where item_id=$1 and school_id=$2',[shared,ids.schoolA]);
 assert.ok((await as(f.user,'select device_sync_state() as s'))[0].s.revision>accessRevision);
 const sibling=await diagnosticFixture();const siblingBefore=(await as(sibling.user,'select device_sync_state() as s'))[0].s.revision;
 await as(ids.adminA,'insert into policies(school_id,device_id) values($1,$2)',[ids.schoolA,f.device]);
 assert.equal((await as(sibling.user,'select device_sync_state() as s'))[0].s.revision,siblingBefore);
});

test('a school edit queues all 300 enrolled devices but excludes pending and retired devices',async()=>{
 const school=(await db.query("insert into schools(name) values('Sync 300 QA') returning id")).rows[0].id;
 await db.query("insert into devices(school_id,status) select $1,'active' from generate_series(1,300)",[school]);
 await db.query("insert into devices(school_id,status) values($1,'pending'),($1,'retired')",[school]);
 await db.query('insert into hub_settings(scope,school_id) values($1,$2)',[school,school]);
 const rows=(await db.query('select status,sync_revision,count(*)::int as n from devices where school_id=$1 group by status,sync_revision',[school])).rows;
 assert.ok(rows.some(r=>r.status==='active'&&r.sync_revision===1&&r.n===300));
 assert.ok(rows.filter(r=>r.status!=='active').every(r=>r.sync_revision===0));
});

test('diagnostics are device-scoped, idempotent, immutable and restricted to school managers',async()=>{
 const {user,device,event}=await diagnosticFixture();const batch=JSON.stringify([event]);
 await rejects(as(null,'select device_report_events($1,$2::jsonb)',[device,batch]));
 await rejects(as(ids.adminA,'select device_report_events($1,$2::jsonb)',[device,batch]));
 await rejects(as(user,'select device_report_events($1,$2::jsonb)',[ids.deviceB,batch]));
 await rejects(as(user,'select store_device_events($1,$2::jsonb)',[device,batch]));
 await as(user,'select device_report_events($1,$2::jsonb)',[device,batch]);
 await as(user,'select device_report_events($1,$2::jsonb)',[device,JSON.stringify([{...event,details:{strict:true}}])]);
 const rows=await as(ids.adminA,'select * from device_events where device_id=$1',[device]);
 assert.equal(rows.length,1);assert.equal(rows[0].details.strict,false);
 assert.equal((await as(ids.adminB,'select * from device_events where device_id=$1',[device])).length,0);
 assert.equal((await as(ids.teacherA,'select * from device_events where device_id=$1',[device])).length,0);
 assert.equal((await as(user,'select * from device_events where device_id=$1',[device])).length,0);
 await rejects(as(user,"delete from device_events where device_id=$1",[device]));
});

test('diagnostic batches reject unsupported private fields and oversized or malformed input atomically',async()=>{
 const {user,device,event}=await diagnosticFixture();
 for(const batch of [[{...event,details:{password:'do-not-accept'}}],Array(31).fill(event),[{...event,severity:'invented'}],[event,{...event,id:'invalid'}]])
  await rejects(as(user,'select device_report_events($1,$2::jsonb)',[device,JSON.stringify(batch)]),/diagnostic|uuid/);
 assert.equal((await db.query('select * from device_events where device_id=$1',[device])).rows.length,0);
});

test('server diagnostic retention remains bounded at 1000 events per device',async()=>{
 const {user,device,event}=await diagnosticFixture();
 await db.query("insert into device_events(device_id,id,occurred_at,received_at,severity,category,code,version) select $1,md5(n::text)::uuid,now(),now()-interval '1 day','info','boot','retention_test','test' from generate_series(1,1000)n",[device]);
 await as(user,'select device_report_events($1,$2::jsonb)',[device,JSON.stringify([event])]);
 assert.equal((await db.query('select count(*)::int as n from device_events where device_id=$1',[device])).rows[0].n,1000);
 assert.equal((await db.query('select * from device_events where device_id=$1 and id=$2',[device,event.id])).rows.length,1);
});

test('pre-unlock diagnostic upload requires its registered capability, is rate limited and rejects retired devices',async()=>{
 const {user,device,event}=await diagnosticFixture();const secret='d'.repeat(64),batch=JSON.stringify([event]);
 await as(user,'select device_register_recovery($1)',[secret]);
 await rejects(as(null,'select device_recovery_events($1,$2,$3::jsonb)',[device,'e'.repeat(64),batch]),/invalid recovery/);
 const accepted=(await as(null,'select device_recovery_events($1,$2,$3::jsonb) as result',[device,secret,batch]))[0].result;
 assert.deepEqual(accepted.accepted_ids,[event.id]);
 const limited=(await as(null,'select device_recovery_events($1,$2,$3::jsonb) as result',[device,secret,batch]))[0].result;
 assert.equal(limited.retry,true);assert.equal(limited.accepted_ids.length,0);
 await db.query("update devices set status='retired' where id=$1",[device]);
 await rejects(as(null,'select device_recovery_events($1,$2,$3::jsonb)',[device,secret,batch]),/invalid recovery/);
 await rejects(as(user,'select device_report_events($1,$2::jsonb)',[device,batch]));
 assert.equal((await as(ids.adminA,'select * from device_events where device_id=$1',[device])).length,1);
});

async function schoolUsageEnabled(enabled) {
 await db.query('insert into hub_settings(scope,school_id,usage_reporting) values($1,$2,$3) on conflict(scope) do update set usage_reporting=excluded.usage_reporting',[ids.schoolA,ids.schoolA,enabled]);
}
async function usagePayload(overrides={}) {
 const day=(await db.query('select current_date::text as day')).rows[0].day;
 return {day,screen_ms:60000,online_ms:50000,uptime_ms:120000,usage_access:true,coverage:'Observed service samples; gaps excluded.',apps:[],...overrides};
}

test('school usage is opt-in and disabled reporting stores no activity',async()=>{
 const f=await diagnosticFixture();await schoolUsageEnabled(false);
 const result=(await as(f.user,"select device_report_usage('{}') as result"))[0].result;
 assert.equal(result.enabled,false);
 assert.equal((await db.query('select * from device_usage_daily where device_id=$1',[f.device])).rows.length,0);
 assert.equal((await db.query('select * from device_app_usage_daily where device_id=$1',[f.device])).rows.length,0);
 await rejects(as(ids.adminA,"select device_report_usage('{}')"));
 await rejects(as(null,"select device_report_usage('{}')"));
});

test('usage retries are cumulative without double counting and cases start at 30 seconds for non-firmware unapproved apps',async()=>{
 const f=await diagnosticFixture();await schoolUsageEnabled(true);
 await db.query("insert into hub_items(school_id,kind,title,storage_path,size,package_name) values($1::uuid,'app','Usage approved QA',$1::text||'/usage-approved-'||gen_random_uuid()||'.apk',200,'org.test.approved')",[ids.schoolA]);
 await db.query('update devices set installed_apps=$1::jsonb where id=$2',[JSON.stringify([{package:'org.test.firmware',system:true}]),f.device]);
 const payload=await usagePayload({apps:[{package:'org.test.unapproved',label:'Unapproved app',foreground_ms:29999},{package:'org.test.firmware',label:'Firmware app',foreground_ms:45000},{package:'org.test.approved',label:'Approved app',foreground_ms:45000},{package:'android',label:'Android',foreground_ms:45000}]});
 for(let n=0;n<2;n++)await as(f.user,'select device_report_usage($1::jsonb)',[JSON.stringify(payload)]);
 let row=(await db.query('select * from device_usage_daily where device_id=$1',[f.device])).rows[0];
 assert.equal(Number(row.screen_ms),60000);assert.equal(Number(row.online_ms),50000);
 assert.equal((await db.query('select * from device_cases where device_id=$1',[f.device])).rows.length,0);
 const bigger={...payload,screen_ms:90000,apps:[{package:'org.test.unapproved',label:'Unapproved app',foreground_ms:30000}]};
 for(let n=0;n<2;n++)await as(f.user,'select device_report_usage($1::jsonb)',[JSON.stringify(bigger)]);
 await as(f.user,'select device_report_usage($1::jsonb)',[JSON.stringify({...payload,screen_ms:1000,online_ms:1000,uptime_ms:1000,apps:[{package:'org.test.unapproved',label:'Unapproved app',foreground_ms:1000}]})]);
 row=(await db.query('select * from device_usage_daily where device_id=$1',[f.device])).rows[0];
 assert.equal(Number(row.screen_ms),90000);assert.equal(Number(row.online_ms),50000);assert.equal(Number(row.uptime_ms),120000);
 const app=(await db.query("select * from device_app_usage_daily where device_id=$1 and package='org.test.unapproved'",[f.device])).rows;
 assert.equal(app.length,1);assert.equal(Number(app[0].foreground_ms),30000);
 const cases=(await db.query('select * from device_cases where device_id=$1',[f.device])).rows;
 assert.equal(cases.length,1);assert.equal(cases[0].package,'org.test.unapproved');assert.equal(cases[0].evidence.foreground_ms,30000);
 for(const foreground_ms of [90000,60000])await as(f.user,'select device_report_usage($1::jsonb)',[JSON.stringify({...payload,apps:[{package:'org.test.unapproved',label:'Unapproved app',foreground_ms}]})]);
 assert.equal((await db.query('select evidence from device_cases where device_id=$1',[f.device])).rows[0].evidence.foreground_ms,90000,'Stale cumulative reports must not shrink case evidence');
});

test('usage rejects missing, malformed and oversized fields atomically while accepting Android package activity',async()=>{
 const f=await diagnosticFixture();await schoolUsageEnabled(true);const valid=await usagePayload();
 for(const value of [null,{}, {...valid,apps:null},{...valid,apps:{}},{...valid,apps:Array(201).fill({package:'org.test.app',foreground_ms:1})},{...valid,screen_ms:-1},{...valid,uptime_ms:86400001},{...valid,apps:[{package:'bad package',foreground_ms:1}]},{...valid,apps:[{package:'org.test.app',foreground_ms:86400001}]}])
  await rejects(as(f.user,'select device_report_usage($1::jsonb)',[JSON.stringify(value)]),/invalid usage|invalid app/);
 assert.equal((await db.query('select * from device_usage_daily where device_id=$1',[f.device])).rows.length,0);
 await as(f.user,'select device_report_usage($1::jsonb)',[JSON.stringify({...valid,apps:[{package:'android',label:'Android',foreground_ms:60000},{package:'com.android.systemui',label:'System UI',foreground_ms:60000}]})]);
 assert.equal((await db.query('select * from device_app_usage_daily where device_id=$1',[f.device])).rows.length,2);
 assert.equal((await db.query('select * from device_cases where device_id=$1',[f.device])).rows.length,0);
});

test('usage, cases and control audit reads stay within school managers and reject direct writes',async()=>{
 const f=await diagnosticFixture();await schoolUsageEnabled(true);
 await as(f.user,'select device_report_usage($1::jsonb)',[JSON.stringify(await usagePayload({apps:[{package:'org.test.boundary',label:'Boundary QA',foreground_ms:60000}]}))]);
 await as(ids.adminA,'select staff_set_lost($1,true,false,\'QA lost device\')',[f.device]);
 for(const table of ['device_usage_daily','device_app_usage_daily','device_cases','device_control_audit']) {
  assert.ok((await as(ids.adminA,`select * from ${table} where device_id=$1`,[f.device])).length>0,table);
  assert.ok((await as(ids.super,`select * from ${table} where device_id=$1`,[f.device])).length>0,table);
  for(const user of [ids.adminB,ids.teacherA,f.user,ids.devB,ids.stray])assert.equal((await as(user,`select * from ${table} where device_id=$1`,[f.device])).length,0,table);
  await rejects(as(null,`select * from ${table}`));
  await rejects(as(ids.adminA,`delete from ${table} where device_id=$1`,[f.device]));
 }
 await as(ids.adminA,'select staff_set_lost($1,false,false,\'\')',[f.device]);
});

test('aggregate usage reports authorize managers, preserve full school totals and exclude future reporting days',async()=>{
 const f=await diagnosticFixture();await schoolUsageEnabled(true);
 await as(f.user,'select device_report_usage($1::jsonb)',[JSON.stringify(await usagePayload({apps:[{package:'org.report.today',label:'Report today',foreground_ms:60000}]}))]);
 const future=(await db.query('select (current_date+1)::text as day')).rows[0].day;
 await as(f.user,'select device_report_usage($1::jsonb)',[JSON.stringify(await usagePayload({day:future,screen_ms:86400000,apps:[{package:'org.report.future',label:'Future excluded',foreground_ms:86400000}]}))]);
 const result=(await as(ids.adminA,'select staff_usage_report($1,7) as result',[ids.schoolA]))[0].result;
 const student=result.devices.find(d=>d.id===f.device);
 assert.ok(student);assert.equal(student.screen_ms,60000);assert.equal(student.reported_days,1);assert.equal(student.usage_access_days,1);
 assert.ok(Array.isArray(student.coverage));assert.ok(!result.apps.some(a=>a.package==='org.report.future'));
 assert.ok(result.devices.length>=300,'The existing 300-device school fixture must be included');
 assert.equal(result.devices.length,(await db.query('select count(*)::int as n from devices where school_id=$1',[ids.schoolA])).rows[0].n);
 for(const user of [ids.teacherA,f.user,ids.devA,ids.stray,ids.adminB])await rejects(as(user,'select staff_usage_report($1,7)',[ids.schoolA]),/administrator/);
 await rejects(as(ids.adminA,'select staff_usage_report($1,7)',[ids.schoolB]),/administrator/);
 await rejects(as(null,'select staff_usage_report($1,7)',[ids.schoolA]));
 await rejects(as(ids.adminA,'select staff_usage_report($1,31)',[ids.schoolA]),/invalid report/);
 assert.ok((await as(ids.super,'select staff_usage_report($1,30) as result',[ids.schoolA]))[0].result.devices.some(d=>d.id===f.device));
});

test('staff cases can be created more than once per day and update only within the managing school',async()=>{
 const f=await diagnosticFixture();
 const created=[];
 for(const title of ['First staff case','Second staff case'])created.push((await as(ids.adminA,'select staff_create_case($1,$2,$3) as result',[f.device,title,'Known facts']))[0].result.id);
 assert.notEqual(created[0],created[1]);
 for(const user of [ids.adminB,ids.teacherA,f.user,ids.stray]) {
  await rejects(as(user,'select staff_create_case($1,\'Forged\',\'\')',[f.device]),/administrator/);
  await rejects(as(user,'select staff_update_case($1,\'resolved\',\'Forged\')',[created[0]]),/administrator/);
 }
 await rejects(as(ids.adminA,'select staff_create_case($1,\'\',\'\')',[f.device]),/invalid case/);
 await rejects(as(ids.adminA,'select staff_update_case($1,\'invalid\',\'\')',[created[0]]),/invalid case/);
 await as(ids.adminA,'select staff_update_case($1,\'observing\',\'Reviewing app approval\')',[created[0]]);
 const row=(await as(ids.adminA,'select * from device_cases where id=$1',[created[0]]))[0];
 assert.equal(row.state,'observing');assert.equal(row.staff_note,'Reviewing app approval');
});

test('lost-device controls lock immediately, preserve prior state and require the latest recovery code',async()=>{
 const f=await diagnosticFixture();
 for(const user of [ids.adminB,ids.teacherA,f.user,ids.stray])await rejects(as(user,'select staff_set_lost($1,true,true,\'Return to school\')',[f.device]),/administrator/);
 await as(ids.adminA,"update devices set status='suspended' where id=$1",[f.device]);
 const first=(await as(ids.adminA,'select staff_set_lost($1,true,true,\'Return to school\') as result',[f.device]))[0].result;
 assert.match(first.recovery_code,/^[A-F0-9]{16}$/);
 let row=(await db.query('select status,lost_mode,lost_alarm,lost_previous_status,lost_recovery_hash from devices where id=$1',[f.device])).rows[0];
 assert.equal(row.status,'locked');assert.equal(row.lost_mode,true);assert.equal(row.lost_alarm,true);assert.equal(row.lost_previous_status,'suspended');assert.notEqual(row.lost_recovery_hash,first.recovery_code);
 await as(ids.adminA,"update devices set status='active' where id=$1",[f.device]);
 assert.equal((await db.query('select status from devices where id=$1',[f.device])).rows[0].status,'locked');
 await rejects(as(f.user,"select device_recover_lost('0000000000000000')"),/invalid recovery/);
 const second=(await as(ids.adminA,'select staff_set_lost($1,true,false,\'Still lost\') as result',[f.device]))[0].result;
 assert.notEqual(second.recovery_code,first.recovery_code);
 await rejects(as(f.user,'select device_recover_lost($1)',[first.recovery_code]),/invalid recovery/);
 await rejects(as(ids.adminA,'select device_recover_lost($1)',[second.recovery_code]));
 await as(f.user,'select device_recover_lost($1)',[second.recovery_code.toLowerCase()]);
 row=(await db.query('select status,lost_mode,lost_alarm,lost_recovery_hash from devices where id=$1',[f.device])).rows[0];
 assert.equal(row.status,'suspended');assert.equal(row.lost_mode,false);assert.equal(row.lost_alarm,false);assert.equal(row.lost_recovery_hash,null);
 await as(ids.adminA,'select staff_set_lost($1,true,false,\'Lost again\')',[f.device]);
 await rejects(as(f.user,'select device_recover_lost($1)',[second.recovery_code]),/invalid recovery/);
 await as(ids.adminA,'select staff_set_lost($1,false,false,\'\')',[f.device]);
 assert.equal((await db.query('select status from devices where id=$1',[f.device])).rows[0].status,'suspended');
});

test('retiring a lost device clears its lost lock and retired accounts cannot recover or upload activity',async()=>{
 const f=await diagnosticFixture();
 const code=(await as(ids.adminA,'select staff_set_lost($1,true,true,\'QA\') as result',[f.device]))[0].result.recovery_code;
 await as(ids.adminA,"update devices set status='retired' where id=$1",[f.device]);
 const row=(await db.query('select status,lost_mode,lost_alarm,lost_recovery_hash from devices where id=$1',[f.device])).rows[0];
 assert.equal(row.status,'retired');assert.equal(row.lost_mode,false);assert.equal(row.lost_alarm,false);assert.equal(row.lost_recovery_hash,null);
 await rejects(as(f.user,'select device_recover_lost($1)',[code]));
 await rejects(as(f.user,'select device_report_usage($1::jsonb)',[JSON.stringify(await usagePayload())]));
 await rejects(as(ids.adminA,'select staff_set_lost($1,true,false,\'\')',[f.device]),/administrator/);
});

test('verified Prime IDs reject UUIDs, placeholders and duplicates and are not overwritten by device runtime',async()=>{
 const f=await diagnosticFixture(),other=await diagnosticFixture(),mac='78:C8:24:B5:8E:12';
 for(const invalid of [null,f.device,'02:00:00:00:00:00','00:00:00:00:00:00','FF:FF:FF:FF:FF:FF','not-a-mac'])await rejects(as(ids.adminA,'select staff_set_prime_id($1,$2)',[f.device,invalid]),/verified Prime ID/);
 for(const user of [ids.adminB,ids.teacherA,f.user,ids.stray])await rejects(as(user,'select staff_set_prime_id($1,$2)',[f.device,mac]),/administrator/);
 await as(ids.adminA,'select staff_set_prime_id($1,$2)',[f.device,mac.toLowerCase()]);
 await rejects(as(ids.adminA,'select staff_set_prime_id($1,$2)',[other.device,mac]),/duplicate|unique/);
 await as(f.user,'select device_runtime_report($1::jsonb)',[JSON.stringify({prime_id:'78:C8:24:B5:8E:13'})]);
 let row=(await db.query('select prime_id,prime_id_source from devices where id=$1',[f.device])).rows[0];
 assert.equal(row.prime_id,mac);assert.equal(row.prime_id_source,'admin_verified');
 await as(other.user,'select device_runtime_report($1::jsonb)',[JSON.stringify({prime_id:mac})]);
 assert.equal((await db.query('select prime_id from devices where id=$1',[other.device])).rows[0].prime_id,null);
 await as(other.user,'select device_runtime_report($1::jsonb)',[JSON.stringify({prime_id:'02:00:00:00:00:00'})]);
 assert.equal((await db.query('select prime_id from devices where id=$1',[other.device])).rows[0].prime_id,null);
 await as(other.user,'select device_runtime_report($1::jsonb)',[JSON.stringify({prime_id:'78:C8:24:B5:8E:14'})]);
 row=(await db.query('select prime_id,prime_id_source from devices where id=$1',[other.device])).rows[0];
 assert.equal(row.prime_id,'78:C8:24:B5:8E:14');assert.equal(row.prime_id_source,'device_hardware');
});

test('student support photos validate JPEG and caption, are device-scoped and retry without duplicates',async()=>{
 const f=await diagnosticFixture(),image='data:image/jpeg;base64,/9j/2Q==';
 const request=(await db.query('select gen_random_uuid() as id')).rows[0].id;
 for(const invalid of [null,'https://evil.test/photo.jpg','data:image/svg+xml;base64,YQ==','data:image/jpeg;base64,'+'A'.repeat(100000)])await rejects(as(f.user,'select device_support_photo($1,\'caption\',gen_random_uuid())',[invalid]),/invalid support photo/);
 await rejects(as(f.user,'select device_support_photo($1,$2,gen_random_uuid())',[image,'A'.repeat(4001)]),/invalid support photo/);
 for(const user of [ids.adminA,ids.teacherA,ids.stray])await rejects(as(user,'select device_support_photo($1,\'forged\',gen_random_uuid())',[image]));
 await rejects(as(null,'select device_support_photo($1,\'forged\',gen_random_uuid())',[image]));
 await as(f.user,'select device_support_photo($1,\'Approved caption\',$2)',[image,request]);
 const replay=(await as(f.user,'select device_support_photo($1,\'Changed caption\',$2) as result',[image,request]))[0].result;
 assert.equal(replay.duplicate,true);
 const rows=await as(ids.adminA,'select * from support_messages where device_id=$1',[f.device]);
 assert.equal(rows.length,1);assert.equal(rows[0].body,'Approved caption');assert.equal(rows[0].attachment_data,image);
 for(const user of [ids.adminB,ids.teacherA,ids.stray])assert.equal((await as(user,'select * from support_messages where device_id=$1',[f.device])).length,0);
 assert.ok((await as(f.user,'select device_hub() as result'))[0].result.support_messages.some(m=>m.attachment_data===image));
});

test('support photo daily cap is enforced while a previously accepted request can still be retried',async()=>{
 const f=await diagnosticFixture(),image='data:image/jpeg;base64,/9j/2Q==',request=(await db.query('select gen_random_uuid() as id')).rows[0].id;
 await as(f.user,'select device_support_photo($1,\'First photo\',$2)',[image,request]);
 await db.query("insert into support_messages(device_id,school_id,sender,body) select $1,$2,'student','Existing support message '||n from generate_series(1,49)n",[f.device,ids.schoolA]);
 await rejects(as(f.user,'select device_support_photo($1,\'Over daily limit\',gen_random_uuid())',[image]),/Daily support message limit/);
 assert.equal((await as(f.user,'select device_support_photo($1,\'Retry\',$2) as result',[image,request]))[0].result.duplicate,true);
 assert.equal((await db.query('select count(*)::int as n from support_messages where device_id=$1',[f.device])).rows[0].n,50);
});

// Communication receipts are private to each reader; attachments remain school-scoped.
const communication = {};
const communicationImage = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';
test('communication setup creates isolated active device',async()=>{
 communication.user=(await db.query("insert into auth.users(email) values('communications-device@t') returning id")).rows[0].id;
 communication.device=(await db.query("insert into devices(school_id,student_name,auth_user_id,status) values($1,'Communication learner',$2,'active') returning id",[ids.schoolA,communication.user])).rows[0].id;
});
test('student report validates category and image and deduplicates offline retries',async()=>{
 const req=(await db.query('select gen_random_uuid() id')).rows[0].id;
 const report={body:'PDF viewer keyboard bug',image:communicationImage,details:{category:'media',steps:'Open a PDF then press the right arrow.',expected:'Move down',actual:'No movement',agent_version:'0.8.1',ui_version:'123',ignored:'not stored'}};
 const call=()=>as(communication.user,"select device_offline_action($1,'bug_report',$2::jsonb) value",[req,JSON.stringify(report)]);
 communication.report=(await call())[0].value.id;assert.equal((await call())[0].value.id,communication.report);
 const rows=await as(ids.adminA,'select * from support_messages where id=$1',[communication.report]);assert.equal(rows.length,1);assert.equal(rows[0].category,'bug_report');assert.equal(rows[0].report_details.ignored,undefined);assert.equal(rows[0].attachment_data,communicationImage);
 for(const user of [ids.adminB,ids.teacherA,ids.devB])assert.equal((await as(user,'select id from support_messages where id=$1',[communication.report])).length,0);
 for(const payload of [{...report,image:'data:image/jpeg;base64,YQ=='},{...report,image:'data:image/svg+xml;base64,YQ=='},{...report,details:{category:'invalid',steps:'x'}},{...report,details:{category:'media',steps:''}},{...report,image:'x'.repeat(115001)}])await rejects(as(communication.user,"select device_offline_action(gen_random_uuid(),'bug_report',$1::jsonb)",[JSON.stringify(payload)]),/Invalid|Choose|invalid/);
});
test('notification authorization handles null helpers and keeps read status per administrator',async()=>{
 const poll=async user=>(await as(user,'select staff_notifications($1) value',[ids.schoolA]))[0].value;
 assert((await poll(ids.adminA)).items.some(i=>i.id===communication.report));
 for(const user of [ids.devA,ids.devB,ids.stray,ids.adminB])await rejects(poll(user),/School access/);
 assert(!(await poll(ids.teacherA)).items.some(i=>i.id===communication.report));
 await as(ids.adminA,"select communication_mark_read('support',array[$1::uuid])",[communication.report]);
 assert(!(await poll(ids.adminA)).items.some(i=>i.id===communication.report));
 assert((await poll(ids.super)).items.some(i=>i.id===communication.report));
 assert.equal((await as(ids.super,'select * from communication_receipts where user_id=$1',[ids.adminA])).length,0);
 await rejects(as(ids.adminA,"insert into communication_receipts(user_id,kind,message_id) values($1,'support',$2)",[ids.super,communication.report]));
});
test('support image reply requires actual school administrator and student reads only own incoming messages',async()=>{
 for(const user of [ids.devA,ids.devB,ids.stray,ids.teacherA,ids.adminB])await rejects(as(user,'select staff_support_post($1,$2,$3)',[communication.device,'Forged support',communicationImage]),/Administrator/);
 communication.reply=(await as(ids.adminA,'select staff_support_post($1,$2,$3) value',[communication.device,'Please share the exact error.',communicationImage]))[0].value.id;
 const hub=async()=>(await as(communication.user,'select device_hub() value'))[0].value;
 assert.equal((await hub()).support_messages.find(m=>m.id===communication.reply).read,false);
 await as(ids.devB,"select communication_mark_read('support',array[$1::uuid])",[communication.reply]);
 assert.equal((await hub()).support_messages.find(m=>m.id===communication.reply).read,false);
 await as(communication.user,"select device_offline_action(gen_random_uuid(),'support_read',jsonb_build_object('ids',jsonb_build_array($1::text)))",[communication.reply]);
 assert.equal((await hub()).support_messages.find(m=>m.id===communication.reply).read,true);
});
test('bug status is manager-only and rejects unknown states',async()=>{
 for(const user of [communication.user,ids.adminB,ids.teacherA,ids.stray])await rejects(as(user,"select staff_bug_status($1,'resolved')",[communication.report]),/Report unavailable/);
 await rejects(as(ids.adminA,"select staff_bug_status($1,'hidden')",[communication.report]),/Invalid/);
 await as(ids.adminA,"select staff_bug_status($1,'reviewing')",[communication.report]);
 assert.equal((await as(communication.user,'select report_status from support_messages where id=$1',[communication.report]))[0].report_status,'reviewing');
});
test('support deletion is scoped to own sent message or school administrator and clears image/details',async()=>{
 for(const user of [ids.devB,ids.stray,ids.teacherA,ids.adminB])await rejects(as(user,'select support_delete_message($1)',[communication.report]),/Message unavailable/);
 await rejects(as(communication.user,'select support_delete_message($1)',[communication.reply]),/Message unavailable/);
 const req=(await db.query('select gen_random_uuid() id')).rows[0].id;
 for(let n=0;n<2;n++)await as(communication.user,"select device_offline_action($1,'support_delete',jsonb_build_object('id',$2::text))",[req,communication.report]);
 const row=(await as(ids.adminA,'select * from support_messages where id=$1',[communication.report]))[0];assert(row.deleted_at);assert.equal(row.body,'Message deleted');assert.equal(row.attachment_data,null);assert.deepEqual(row.report_details,{});
 await as(ids.adminA,'select support_delete_message($1)',[communication.reply]);
 assert.equal((await as(communication.user,'select attachment_data from support_messages where id=$1',[communication.reply]))[0].attachment_data,null);
});
test('form deletion preserves students and resources and cannot bypass guarded RPC',async()=>{
 await as(ids.adminA,"insert into school_classes(school_id,form_level,class_name) values($1,'Delete QA','A'),($1,'Delete QA','B')",[ids.schoolA]);
 await db.query("update devices set form_level='Delete QA',class_name='A' where id=$1",[communication.device]);
 await rejects(as(ids.adminA,"select staff_delete_school_group($1,'Delete QA',null)",[ids.schoolA]),/Move assigned students/);
 for(const user of [ids.teacherA,ids.adminB,communication.user,ids.stray])await rejects(as(user,"select staff_delete_school_group($1,'Delete QA','B')",[ids.schoolA]),/Administrator/);
 await rejects(as(ids.adminA,"delete from school_classes where school_id=$1 and form_level='Delete QA'",[ids.schoolA]));
 await as(ids.adminA,"select staff_delete_school_group($1,'Delete QA','B')",[ids.schoolA]);
 assert.equal((await as(ids.adminA,"select class_name from school_classes where school_id=$1 and form_level='Delete QA'",[ids.schoolA]))[0].class_name,'A');
 await db.query("update devices set form_level='',class_name='' where id=$1",[communication.device]);
 await as(ids.adminA,"select staff_delete_school_group($1,'Delete QA',null)",[ids.schoolA]);
 assert.equal((await as(ids.adminA,"select * from school_classes where school_id=$1 and form_level='Delete QA'",[ids.schoolA])).length,0);
 assert.equal((await as(ids.adminA,'select id from devices where id=$1',[communication.device])).length,1);
});

test('device recovery controls are manager-scoped and cannot be forged by clients',async()=>{
 for(const user of [null,ids.stray,ids.teacherA,ids.adminB,communication.user])await rejects(as(user,"select staff_device_safety($1,'safe_on')",[communication.device]),/permission denied|Administrator/);
 await rejects(as(ids.adminA,"select staff_device_safety($1,'invalid')",[communication.device]),/Invalid/);
 await rejects(as(ids.adminA,"insert into device_safety_controls(device_id,safe_mode) values($1,true)",[communication.device]));
 const c=(await as(ids.adminA,"select staff_device_safety($1,'safe_on') value",[communication.device]))[0].value;
 assert.equal(c.safe_mode,true);assert.equal(c.updates_paused,true);assert.equal(Number(c.revision),1);
 assert.equal((await as(ids.adminB,'select * from device_safety_controls where device_id=$1',[communication.device])).length,0);
 assert.equal((await as(communication.user,'select * from device_safety_controls where device_id=$1',[communication.device])).length,0);
 await rejects(as(communication.user,'select device_safety_payload($1)',[communication.device]));
});
test('recovery pauses updates, tracks interface rollback and resumes controls separately',async()=>{
 const poll=async()=>(await as(communication.user,"select device_check_in('{\"agent_version_code\":18}') value"))[0].value;
 assert.equal((await poll()).agent_update,null);assert.equal((await poll()).recovery_control.safe_mode,true);
 const c=(await as(ids.adminA,"select staff_device_safety($1,'rollback_ui') value",[communication.device]))[0].value;
 assert.equal(Number(c.ui_rollback_revision),2);
 await as(ids.adminA,"select staff_device_safety($1,'safe_off')",[communication.device]);
 const off=(await poll()).recovery_control;assert.equal(off.safe_mode,false);assert.equal(off.updates_paused,true);
 await as(ids.adminA,"select staff_device_safety($1,'resume_updates')",[communication.device]);assert.equal((await poll()).recovery_control.updates_paused,false);
});
test('direct boot capability delivers only its own recovery settings without a password escrow token',async()=>{
 const secret='d'.repeat(64);
 await as(communication.user,'select device_register_recovery($1)',[secret]);
 await as(ids.adminA,"select staff_device_safety($1,'safe_on')",[communication.device]);
 for(const [device,key] of [[ids.deviceB,secret],[communication.device,'e'.repeat(64)]])await rejects(as(null,'select device_recovery_poll($1,$2)',[device,key]),/invalid recovery/);
 const r=(await as(null,'select device_recovery_poll($1,$2) value',[communication.device,secret]))[0].value;
 assert.equal(r.recovery_control.safe_mode,true);assert.equal(r.student_name,undefined);assert.equal(r.policy,undefined);
});
test('prepared recovery APK must be newer and selected by super admin only',async()=>{
 const old=(await as(ids.super,"insert into agent_releases(version_code,version_name,storage_path,active,sha256) values(17,'old','releases/old.apk',false,$1) returning id",['a'.repeat(64)]))[0].id;
 const newer=(await as(ids.super,"insert into agent_releases(version_code,version_name,storage_path,active,sha256) values(999,'recovery','releases/recovery.apk',false,$1) returning id",['b'.repeat(64)]))[0].id;
 await rejects(as(ids.adminA,"select staff_device_safety($1,'install_recovery',$2)",[communication.device,newer]),/Only RoboKorda/);
 await rejects(as(ids.super,"select staff_device_safety($1,'install_recovery',$2)",[communication.device,old]),/higher/);
 await as(ids.super,"select staff_device_safety($1,'install_recovery',$2)",[communication.device,newer]);
 const r=(await as(communication.user,"select device_check_in('{\"agent_version_code\":18}') value"))[0].value;
 assert.equal(r.agent_update.version_code,999);assert.equal(r.recovery_control.updates_paused,true);
 // No other device receives the paused recovery release.
 assert.notEqual((await as(ids.devB,"select device_check_in('{\"agent_version_code\":18}') value"))[0].value.agent_update?.version_code,999);
});

test('learning requests are offline-idempotent and remain device and school scoped',async()=>{
 const req=(await db.query('select gen_random_uuid() id')).rows[0].id;
 const payload={name:'Chemistry 2024 Paper 2',resource_type:'Past exam papers',form_level:'Form 4',subject:'Chemistry',reason:'Revision'};
 for(let i=0;i<2;i++)await as(communication.user,"select device_offline_action($1,'request_resource',$2)",[req,payload]);
 const rows=await as(ids.adminA,"select * from hub_requests where name=$1",[payload.name]);
 assert.equal(rows.length,1);assert.equal(rows[0].kind,'resource');assert.equal(rows[0].device_id,communication.device);
 assert.equal((await as(ids.adminB,"select * from hub_requests where name=$1",[payload.name])).length,0);
 assert.equal((await as(ids.devB,"select * from hub_requests where name=$1",[payload.name])).length,0);
 const hub=(await as(communication.user,'select device_hub() value'))[0].value;
 assert(hub.resource_requests.some(r=>r.name===payload.name&&r.status==='requested'));
 await as(ids.adminA,"update hub_requests set status='reviewing' where id=$1",[rows[0].id]);
 assert.equal((await as(communication.user,'select device_hub() value'))[0].value.resource_requests.find(r=>r.name===payload.name).status,'reviewing');
 for(const user of [null,ids.stray,ids.adminA])await rejects(as(user,"select device_offline_action(gen_random_uuid(),'request_resource',$1)",[payload]),/permission denied|not an active/);
 await rejects(as(communication.user,"select device_offline_action(gen_random_uuid(),'request_resource',$1)",[{...payload,resource_type:'invalid'}]),/Invalid/);
});

test('learning request limits include app requests and do not duplicate on retries',async()=>{
 await db.query("insert into hub_requests(device_id,school_id,name) select $1,$2,'Limit fixture' from generate_series(1,10)",[communication.device,ids.schoolA]);
 await rejects(as(communication.user,"select device_offline_action(gen_random_uuid(),'request_resource','{\"name\":\"Book\",\"resource_type\":\"Book\"}')"),/Daily request limit/);
});

test('notes folder create rename delete preserve files and reject other schools and students',async()=>{
 const path=['Folder QA','Chemistry','Notes'];
 for(const user of [null,ids.stray,ids.teacherA,ids.adminB,communication.user])await rejects(as(user,"select staff_library_folder($1,false,'create',$2)",[ids.schoolA,path]),/permission denied|Administrator/);
 await rejects(as(ids.adminA,"select staff_library_folder($1,true,'create',$2)",[ids.schoolA,path]),/Administrator/);
 await as(ids.adminA,"select staff_library_folder($1,false,'create',$2)",[ids.schoolA,path]);
 assert.equal((await as(ids.adminA,"select * from hub_folders where path[1]='Folder QA'")).length,3);
 await rejects(as(communication.user,"insert into hub_folders(school_id,scope,path) values($1::uuid,$1::uuid::text,$2)",[ids.schoolA,path]));
 const item=(await as(ids.adminA,"insert into hub_items(school_id,kind,title,form_level,subject,category,storage_path,size) values($1::uuid,'resource','Folder fixture','Folder QA','Chemistry','Notes',$1::uuid::text||'/folder-fixture.pdf',10) returning id",[ids.schoolA]))[0].id;
 await rejects(as(ids.adminA,"select staff_library_folder($1,false,'delete',$2)",[ids.schoolA,['Folder QA']]),/contains files/);
 await as(ids.adminA,"select staff_library_folder($1,false,'rename',$2,'Science')",[ids.schoolA,['Folder QA','Chemistry']]);
 assert.equal((await as(ids.adminA,'select subject,storage_path from hub_items where id=$1',[item]))[0].subject,'Science');
 assert.equal((await as(ids.adminA,'select storage_path from hub_items where id=$1',[item]))[0].storage_path,ids.schoolA+'/folder-fixture.pdf');
 await as(ids.adminA,"select staff_library_folder($1,false,'create',$2)",[ids.schoolA,['Folder QA','Physics']]);
 await rejects(as(ids.adminA,"select staff_library_folder($1,false,'rename',$2,'Physics')",[ids.schoolA,['Folder QA','Science']]),/already exists/);
 await as(ids.adminA,"update hub_items set subject='Elsewhere' where id=$1",[item]);
 await as(ids.adminA,"select staff_library_folder($1,false,'delete',$2)",[ids.schoolA,['Folder QA','Science']]);
 assert.equal((await as(ids.adminA,'select id from hub_items where id=$1',[item])).length,1);
 for(const path of [[],['Bad/path'],['ok','ok','ok','too deep']])await rejects(as(ids.adminA,"select staff_library_folder($1,false,'create',$2)",[ids.schoolA,path]),/valid folder/);
});
