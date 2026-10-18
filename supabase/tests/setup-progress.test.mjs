import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite(), ids = {};
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [uid || '']);
    return (await tx.query(sql, params)).rows;
  });
}
function report({ complete = false, empty = false, elapsed = 10000 } = {}) {
  return { catalog_known: true, complete, clock_estimated: false, session_id: '10000000-0000-0000-0000-000000000001',
    catalog_signature: 'a'.repeat(64), elapsed_ms: elapsed, streams: ['wallpaper','app','resource'].map((kind, i) => ({ kind,
      total_items: empty ? 0 : 2, completed_items: complete ? (empty ? 0 : 2) : i === 0 ? 2 : 1,
      total_bytes: empty ? 0 : 200, completed_bytes: empty ? 0 : complete || i === 0 ? 200 : 100,
      elapsed_ms: elapsed, complete: complete || i === 0 })) };
}
async function submit(uid, payload = report()) { return as(uid, 'select device_report_setup_progress($1::jsonb) as result', [JSON.stringify(payload)]); }
before(async () => {
  const baseline = readFileSync(new URL('./rls.test.mjs', import.meta.url), 'utf8');
  await db.exec(baseline.match(/const SUPABASE_STUB = `([\s\S]*?)`;/)[1]);
  await db.exec('alter table storage.buckets add column file_size_limit bigint');
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    try { await db.exec(readFileSync(new URL(file, dir), 'utf8').replace(/^\uFEFF/, '')); }
    catch (e) { throw new Error(file + ': ' + e.message); }
  }
  for (const key of ['adminA','adminB','super','teacher','deviceA','deviceB','stray'])
    ids[key] = (await db.query('insert into auth.users(email) values($1) returning id', [key+'@setup.test'])).rows[0].id;
  for (const key of ['schoolA','schoolB']) ids[key] = (await db.query('insert into schools(name) values($1) returning id', [key])).rows[0].id;
  await db.query("insert into profiles(id,school_id,role) values($1,$4,'school_admin'),($2,$5,'school_admin'),($3,$4,'teacher'),($6,null,'super_admin')", [ids.adminA, ids.adminB, ids.teacher, ids.schoolA, ids.schoolB, ids.super]);
  for (const key of ['A','B']) ids['row'+key] = (await db.query("insert into devices(school_id,auth_user_id,status) values($1,$2,'active') returning id", [ids['school'+key], ids['device'+key]])).rows[0].id;
});
after(() => db.close());

test('device reports bind to authenticated enrollment, not supplied school/device identifiers', async () => {
  await submit(ids.deviceA, {...report(), device_id: ids.rowB, school_id: ids.schoolB, secret:'discard me'});
  const row = (await db.query('select * from device_setup_progress where device_id=$1', [ids.rowA])).rows[0];
  assert.equal(row.school_id, ids.schoolA); assert.equal(row.auth_user_id, ids.deviceA);
  assert(!('secret' in row.report)); assert(!('device_id' in row.report));
  assert.equal(row.completed_at, null);
});
test('anonymous, staff and unenrolled users cannot spoof a device report or write the table directly', async () => {
  for (const uid of [null, ids.adminA, ids.teacher, ids.stray]) await assert.rejects(submit(uid), /permission|enrolled/i);
  await assert.rejects(as(ids.deviceA, 'delete from device_setup_progress'), /permission/i);
  await assert.rejects(as(ids.deviceA, "update device_setup_progress set report='{}'"), /permission/i);
});
test('same-school admin and super admin can read; other schools, teachers and devices cannot', async () => {
  assert.equal((await as(ids.adminA, 'select * from device_setup_progress')).length, 1);
  assert.equal((await as(ids.super, 'select * from device_setup_progress')).length, 1);
  for (const uid of [ids.adminB, ids.teacher, ids.deviceA, ids.deviceB, ids.stray])
    assert.equal((await as(uid, 'select * from device_setup_progress')).length, 0);
  await assert.rejects(as(null, 'select * from device_setup_progress'), /permission/i);
});
test('invalid counters, duplicate/missing streams, oversized/unknown catalogue reports fail atomically', async () => {
  const bad = [];
  const clone = () => structuredClone(report());
  let r = clone(); r.streams[1].kind='wallpaper'; bad.push(r);
  r=clone(); r.streams.pop(); bad.push(r);
  r=clone(); r.streams[0].completed_items=99; bad.push(r);
  r=clone(); r.streams[1].complete=true; bad.push(r);
  r=clone(); r.complete=true; bad.push(r);
  r=clone(); r.streams[0].completed_bytes=201; bad.push(r);
  r=clone(); r.streams[0].total_items=-1; bad.push(r);
  r=clone(); r.streams[0].elapsed_ms=20000; bad.push(r);
  r=clone(); r.catalog_known=false; bad.push(r);
  r=clone(); r.extra='x'.repeat(9000); bad.push(r);
  for (const payload of bad) await assert.rejects(submit(ids.deviceA,payload), /Invalid|Expected|Inconsistent/i);
});
test('averages count completed non-empty samples only and never infer completion from report age', async () => {
  await submit(ids.deviceA, report({complete:true,elapsed:60000}));
  await submit(ids.deviceB, report({complete:false,elapsed:900000}));
  await db.query("update device_setup_progress set reported_at=now()-interval '4 days' where device_id=$1", [ids.rowB]);
  const summary = (await as(ids.super,'select staff_setup_summary($1) as value',[ids.schoolA]))[0].value;
  assert.equal(summary.setup_samples,1); assert.equal(Number(summary.avg_setup_ms),60000);
  assert.equal(summary.streams.find(s=>s.kind==='app').samples,1);
  const incomplete = (await as(ids.adminB,'select staff_setup_summary($1) as value',[ids.schoolB]))[0].value;
  assert.equal(incomplete.setup_samples,0); assert.equal(incomplete.avg_setup_ms,null);
  assert.equal(incomplete.complete_devices,0);
  assert.equal(incomplete.streams.find(s=>s.kind==='wallpaper').samples,1);
  for (const uid of [ids.adminB,ids.teacher,ids.deviceA,ids.stray,null])
    await assert.rejects(as(uid,'select staff_setup_summary($1)',[ids.schoolA]), /permission|administrator/i);
});
test('catalogue changes clear completion; known empty streams are ready but excluded from duration averages', async () => {
  const pending = report(); pending.session_id='20000000-0000-0000-0000-000000000001'; pending.catalog_signature='b'.repeat(64);
  await submit(ids.deviceA,pending);
  assert.equal((await db.query('select completed_at from device_setup_progress where device_id=$1',[ids.rowA])).rows[0].completed_at,null);
  await submit(ids.deviceA,report({complete:true,empty:true,elapsed:0}));
  const summary = (await as(ids.adminA,'select staff_setup_summary($1) as value',[ids.schoolA]))[0].value;
  assert.equal(summary.complete_devices,1); assert.equal(summary.setup_samples,0);
  assert(summary.streams.every(s=>s.samples===0 && s.avg_elapsed_ms===null));
});
test('retired/re-enrolled devices do not leave visible stale completion or accept old-account writes', async () => {
  await db.query("update devices set status='retired' where id=$1",[ids.rowA]);
  assert.equal((await as(ids.adminA,'select * from device_setup_progress')).length,0);
  await assert.rejects(submit(ids.deviceA),/enrolled/i);
  await db.query("update devices set status='active',auth_user_id=$2 where id=$1",[ids.rowA,ids.stray]);
  assert.equal((await as(ids.adminA,'select * from device_setup_progress')).length,0);
  await assert.rejects(submit(ids.deviceA),/enrolled/i);
  await submit(ids.stray); assert.equal((await as(ids.adminA,'select * from device_setup_progress')).length,1);
});
