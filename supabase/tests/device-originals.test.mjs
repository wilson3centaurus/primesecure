import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite(), ids = {};
const migration = '20261018232514_device_media_on_demand.sql';
const modified = 1700000000123;
async function as(uid, sql, args = []) {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [uid ?? '']);
    return (await tx.query(sql, args)).rows;
  });
}
async function request(path, who = ids.adminA, device = ids.deviceA, size = 100) {
  return (await as(who, 'select request_device_file($1,$2,$3,$4) as result', [device, path, size, modified]))[0].result;
}
async function ticket(id, who = ids.devA) { return (await as(who, 'select device_file_transfer_ticket($1) as result', [id]))[0].result; }
async function storagePath(id) { return (await db.query('select storage_path from device_file_transfers where id=$1', [id])).rows[0].storage_path; }
async function upload(id, size = 100) {
  const path = await storagePath(id);
  await as(ids.devA, "insert into storage.objects(bucket_id,name,metadata) values('device-file-originals',$1,jsonb_build_object('size',$2::bigint))", [path, size]);
  return path;
}
before(async () => {
  const stub = readFileSync(new URL('./rls.test.mjs', import.meta.url), 'utf8').match(/const SUPABASE_STUB = `([\s\S]*?)`;/)[1];
  await db.exec(stub);
  await db.exec('alter table storage.buckets add column file_size_limit bigint; alter table storage.objects add column metadata jsonb; create unique index storage_test_unique on storage.objects(bucket_id,name);');
  // Test this feature against committed migrations, not concurrent agents' drafts.
  const files = execFileSync('git', ['ls-files', 'supabase/migrations'], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' }).trim().split(/\r?\n/).map(p => p.split('/').pop()).filter(f => f.endsWith('.sql') && f !== migration).sort();
  for (const file of files) await db.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  await db.exec(readFileSync(new URL('../migrations/' + migration, import.meta.url), 'utf8'));
  for (const key of ['adminA', 'adminB', 'teacher', 'devA', 'devB', 'stray', 'super']) ids[key] = (await db.query('insert into auth.users(email) values($1) returning id', [key + '@originals.test'])).rows[0].id;
  for (const key of ['schoolA', 'schoolB']) ids[key] = (await db.query('insert into schools(name) values($1) returning id', [key])).rows[0].id;
  await db.query("insert into profiles(id,role,school_id) values($1,'school_admin',$4),($2,'school_admin',$5),($3,'teacher',$4),($6,'super_admin',null)", [ids.adminA, ids.adminB, ids.teacher, ids.schoolA, ids.schoolB, ids.super]);
  for (const suffix of ['A', 'B']) ids['device' + suffix] = (await db.query("insert into devices(school_id,auth_user_id,status) values($1,$2,'active') returning id", [ids['school' + suffix], ids['dev' + suffix]])).rows[0].id;
  const entries = ['notes.pdf', 'ready.pdf', 'pending.jpg', 'wrong-size.pdf', 'expire.jpg', 'cancel.jpg', 'cleanup.jpg', 'move.jpg', 'limit.pdf', 'huge.pdf'].map(name => ({ path: 'Download/' + name, name, parent: 'Download', dir: false, size: name === 'limit.pdf' ? 500000000 : name === 'huge.pdf' ? 500000001 : 100, modified, kind: 'document' }));
  await as(ids.devA, 'select device_file_snapshot($1)', [{ entries }]);
});
after(() => db.close());

test('only manager of the current device school (or super admin) can request; denies anonymous, teacher, device, stray, other school', async () => {
  for (const who of [null, ids.teacher, ids.devA, ids.devB, ids.stray, ids.adminB]) await assert.rejects(request('Download/notes.pdf', who), /permission|administrator/i);
  const r = await request('Download/notes.pdf');
  const row = (await db.query('select * from device_file_transfers where id=$1', [r.request_id])).rows[0];
  assert.equal(row.school_id, ids.schoolA); assert.equal(row.device_id, ids.deviceA); assert.equal(row.requested_by, ids.adminA);
  const command = (await db.query('select * from commands where id=$1', [r.command_id])).rows[0];
  assert.equal(command.type, 'retrieve_file'); assert.deepEqual(command.payload, { request_id: r.request_id }); assert.equal(command.created_by, ids.adminA);
  assert((await request('Download/notes.pdf', ids.super)).request_id);
});
test('repeat request reuses one original and audit command', async () => {
  const a = await request('Download/notes.pdf'), b = await request('Download/notes.pdf');
  assert.equal(a.request_id, b.request_id); assert.equal(a.command_id, b.command_id);
});
test('request validates cached metadata, traversal, private/hidden paths, and decimal 500 MB ceiling', async () => {
  for (const path of ['/data/private', '../escape', 'Download/../escape', 'Download\\evil', 'Android/data/app/private', 'Android/obb/app/a', '@usb/ABCD-1234/Android/data/x', '.hidden/file', 'Download/.hidden', 'Download//a', 'Download/a:stream']) await assert.rejects(request(path), /Invalid/);
  await assert.rejects(request('Download/absent.pdf'), /absent/);
  await assert.rejects(request('Download/notes.pdf', ids.adminA, ids.deviceA, 101), /metadata changed/);
  assert((await request('Download/limit.pdf', ids.adminA, ids.deviceA, 500000000)).request_id);
  await assert.rejects(request('Download/huge.pdf', ids.adminA, ids.deviceA, 500000001), /500 MB/);
  const bucket = (await db.query("select public,file_size_limit from storage.buckets where id='device-file-originals'")).rows[0];
  assert.equal(bucket.public, false); assert.equal(Number(bucket.file_size_limit), 500000000);
});
test('devices cannot request commands or edit transfer rows; tickets bind device and request', async () => {
  const r = await request('Download/pending.jpg');
  assert.equal((await ticket(r.request_id)).path, 'Download/pending.jpg');
  for (const who of [null, ids.devB, ids.teacher, ids.adminA, ids.stray]) await assert.rejects(ticket(r.request_id, who), /permission|unavailable/i);
  await assert.rejects(as(ids.devA, "insert into commands(device_id,type,payload,created_by) values($1,'retrieve_file','{}',$2)", [ids.deviceA, ids.devA]), /permission|row-level/);
  await assert.rejects(as(ids.devA, 'update device_file_transfers set completed_at=now() where id=$1', [r.request_id]), /permission/);
});
test('only the requested device can insert the exact pending object; no overwrites, listing or reads by devices', async () => {
  const r = await request('Download/ready.pdf'), path = await storagePath(r.request_id);
  for (const who of [ids.adminA, ids.devB, ids.teacher, null]) await assert.rejects(as(who, "insert into storage.objects(bucket_id,name) values('device-file-originals',$1)", [path]), /permission|row-level/);
  await assert.rejects(as(ids.devA, "insert into storage.objects(bucket_id,name) values('device-file-originals',$1)", [path + '-other']), /row-level/);
  await upload(r.request_id);
  assert.equal((await ticket(r.request_id)).uploaded, true);
  assert.equal((await as(ids.devA, "select * from storage.objects where bucket_id='device-file-originals'")).length, 0);
  assert.equal((await as(ids.adminA, "select * from storage.objects where bucket_id='device-file-originals'")).length, 0);
  assert.equal((await as(ids.devA, 'update storage.objects set metadata=\'{"size":2}\' where name=$1 returning id', [path])).length, 0);
});
test('completion checks actual uploaded size; complete originals downloadable only by own-school managers', async () => {
  const r = await request('Download/ready.pdf'), path = await storagePath(r.request_id);
  await assert.rejects(as(ids.devA, 'select device_file_transfer_complete($1,99,$2)', [r.request_id, modified]), /changed/);
  await as(ids.devA, 'select device_file_transfer_complete($1,100,$2)', [r.request_id, modified]);
  assert.equal((await ticket(r.request_id)).ready, true);
  for (const who of [ids.adminA, ids.super]) assert.equal((await as(who, 'select name from storage.objects where name=$1', [path])).length, 1);
  for (const who of [ids.adminB, ids.teacher, ids.devA, ids.devB, ids.stray]) {
    assert.equal((await as(who, 'select name from storage.objects where name=$1', [path])).length, 0);
    await assert.rejects(as(who, 'select admin_device_file_transfer($1)', [r.request_id]), /unavailable/);
  }
  const state = (await as(ids.adminA, 'select admin_device_file_transfer($1) as s', [r.request_id]))[0].s;
  assert.equal(state.status, 'ready'); assert.equal(state.storage_path, path);
  const bad = await request('Download/wrong-size.pdf'); await upload(bad.request_id, 99);
  await assert.rejects(as(ids.devA, 'select device_file_transfer_complete($1,100,$2)', [bad.request_id, modified]), /size mismatch/);
});
test('expiry, cancellation and school reassignment revoke storage tickets/access', async () => {
  const r = await request('Download/expire.jpg'); await upload(r.request_id); await as(ids.devA, 'select device_file_transfer_complete($1,100,$2)', [r.request_id, modified]);
  await db.query("update device_file_transfers set expires_at=created_at-interval '1 second' where id=$1", [r.request_id]);
  await assert.rejects(ticket(r.request_id), /unavailable/);
  const state = (await as(ids.adminA, 'select admin_device_file_transfer($1) as s', [r.request_id]))[0].s;
  assert.equal(state.status, 'expired'); assert.equal(state.storage_path, null);
  assert.equal((await as(ids.adminA, 'select * from storage.objects where name=$1', [await storagePath(r.request_id)])).length, 0);
  const cancel = await request('Download/cancel.jpg'); await as(ids.adminA, "update commands set status='cancelled' where id=$1", [cancel.command_id]);
  await assert.rejects(ticket(cancel.request_id), /unavailable/);
  await assert.rejects(upload(cancel.request_id), /row-level/);
  const move = await request('Download/move.jpg'); await upload(move.request_id); await as(ids.devA, 'select device_file_transfer_complete($1,100,$2)', [move.request_id, modified]);
  await db.query('update devices set school_id=$1 where id=$2', [ids.schoolB, ids.deviceA]);
  await assert.rejects(ticket(move.request_id), /unavailable/);
  await assert.rejects(as(ids.adminA, 'select admin_device_file_transfer($1)', [move.request_id]), /unavailable/);
  assert.equal((await as(ids.adminA, 'select * from storage.objects where name=$1', [await storagePath(move.request_id)])).length, 0);
  await db.query('update devices set school_id=$1 where id=$2', [ids.schoolA, ids.deviceA]);
});
test('retired devices and anonymous private helper execution fail closed', async () => {
  await db.query("update devices set status='retired' where id=$1", [ids.deviceA]);
  await assert.rejects(request('Download/notes.pdf'), /not enrolled/);
  await assert.rejects(ticket((await db.query('select id from device_file_transfers limit 1')).rows[0].id), /unavailable/);
  await db.query("update devices set status='active' where id=$1", [ids.deviceA]);
  await assert.rejects(as(null, "select device_media_private.can_upload('x')"), /permission/);
});
test('deleting a device preserves the expiring cleanup pointer but revokes original access', async () => {
  const r = await request('Download/cleanup.jpg'); const path = await upload(r.request_id);
  await as(ids.devA, 'select device_file_transfer_complete($1,100,$2)', [r.request_id, modified]);
  await db.query('delete from devices where id=$1', [ids.deviceA]);
  const row = (await db.query('select device_id,storage_path,expires_at,cleaned_at from device_file_transfers where id=$1', [r.request_id])).rows[0];
  assert.equal(row.device_id, null); assert.equal(row.storage_path, path); assert.equal(row.cleaned_at, null);
  assert.equal((await as(ids.adminA, 'select * from storage.objects where name=$1', [path])).length, 0);
  await assert.rejects(ticket(r.request_id), /unavailable/);
});
