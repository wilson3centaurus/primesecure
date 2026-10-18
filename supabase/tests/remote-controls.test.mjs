import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';

const db=new PGlite(),ids={};
const migration='20261018232234_visible_remote_controls_cases.sql';
async function as(uid,sql,params=[]) { return db.transaction(async tx=>{
 await tx.exec(`set local role ${uid?'authenticated':'anon'}`);
 await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uid||'']);
 return (await tx.query(sql,params)).rows;
}); }
async function fresh() {
 const uid=(await db.query("insert into auth.users(email) values('remote-'||gen_random_uuid()||'@test') returning id")).rows[0].id;
 const device=(await db.query("insert into devices(school_id,auth_user_id,status) values($1,$2,'active') returning id",[ids.schoolA,uid])).rows[0].id;
 return {uid,device};
}
async function request(device,type='alarm',extra={}) {
 return (await as(ids.admin,"select staff_request_remote_control($1,$2,$3,$4,$5,$6,$7) as result",[device,type,extra.reason??'Authorized school support request',extra.authorized??true,extra.seconds??15,extra.kind??null,extra.caseId??null]))[0].result.id;
}
before(async()=>{
 const stub=readFileSync(new URL('./rls.test.mjs',import.meta.url),'utf8').match(/const SUPABASE_STUB = `([\s\S]*?)`;/)[1];
 await db.exec(stub);await db.exec('alter table storage.buckets add column file_size_limit bigint');
 // Deliberately exclude parallel agents' unfinished/untracked migrations.
 const tracked=execFileSync('git',['ls-files','supabase/migrations/*.sql'],{cwd:new URL('../../',import.meta.url),encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean).sort();
 for(const name of tracked.filter(f=>!f.endsWith(migration))) {
  try { await db.exec(readFileSync(new URL('../../'+name,import.meta.url),'utf8').replace(/^\uFEFF/,'')); }
  catch(e) { throw new Error(name+': '+e.message); }
 }
 for(const name of ['admin','adminB','teacher','device','deviceB','super']) ids[name]=(await db.query('insert into auth.users(email) values($1) returning id',[name+'@remote.test'])).rows[0].id;
 ids.schoolA=(await db.query("insert into schools(name) values('Remote A') returning id")).rows[0].id;
 ids.schoolB=(await db.query("insert into schools(name) values('Remote B') returning id")).rows[0].id;
 await db.query("insert into profiles(id,school_id,role) values($1,$4,'school_admin'),($2,$5,'school_admin'),($3,$4,'teacher'),($6,null,'super_admin')",[ids.admin,ids.adminB,ids.teacher,ids.schoolA,ids.schoolB,ids.super]);
 ids.deviceA=(await db.query("insert into devices(school_id,auth_user_id,status) values($1,$2,'active') returning id",[ids.schoolA,ids.device])).rows[0].id;
 ids.deviceBId=(await db.query("insert into devices(school_id,auth_user_id,status) values($1,$2,'active') returning id",[ids.schoolB,ids.deviceB])).rows[0].id;
 const known=['com.android.launcher3','com.android.documentsui','com.floydwiz.primesetup','com.floydwiz.primeos.appcompat'];
 for(const pkg of known) await db.query("insert into device_cases(device_id,school_id,category,title,package,day) values($1,$2,'unapproved_app','Old automatic case',$3,current_date-1)",[ids.deviceA,ids.schoolA,pkg]);
 await db.query("insert into device_cases(device_id,school_id,category,title,package,staff_note,day) values($1,$2,'unapproved_app','Staff reviewed launcher','com.android.launcher3','Staff note preserved',current_date-2),($1,$2,'manual','Manual launcher case','com.android.launcher3','',current_date-1)",[ids.deviceA,ids.schoolA]);
 await db.query("insert into hub_settings(scope,usage_reporting) values('global',true)");
 await db.exec(readFileSync(new URL('../migrations/'+migration,import.meta.url),'utf8'));
 // Explicit integration check: the media migration must preserve these command types.
 const media=new URL('../migrations/20261018232514_device_media_on_demand.sql',import.meta.url);
 if(existsSync(media)) {
  await db.exec('alter table storage.objects add column if not exists metadata jsonb');
  await db.exec(readFileSync(media,'utf8'));
 }
});
after(async()=>db.close());

test('migration resolves only untouched exact system automatic cases, preserving staff history',async()=>{
 const rows=(await db.query('select category,state,staff_note,evidence from device_cases order by title')).rows;
 assert.equal(rows.filter(r=>r.state==='resolved').length,4);
 assert(rows.filter(r=>r.state==='resolved').every(r=>r.evidence.classification==='expected_system_component'));
 assert.equal(rows.find(r=>r.staff_note==='Staff note preserved').state,'open');
 assert.equal(rows.find(r=>r.category==='manual').state,'open');
});
test('usage keeps exact OS components in reports but flags unknown lookalikes and unapproved apps',async()=>{
 const packages=['com.android.launcher3','com.android.documentsui','com.floydwiz.primesetup','com.floydwiz.primeos.appcompat','com.android.launcher3.fake','com.floydwiz.unknown','org.unapproved.app'];
 const payload={day:new Date().toISOString().slice(0,10),screen_ms:60000,online_ms:60000,uptime_ms:60000,usage_access:true,apps:packages.map(packageName=>({package:packageName,label:'App',foreground_ms:60000}))};
 await as(ids.device,'select device_report_usage($1)',[payload]);
 const rows=(await db.query('select package from device_cases where day=current_date')).rows;
 assert.deepEqual(rows.map(r=>r.package).sort(),packages.slice(4).sort());
 assert.equal((await db.query('select count(*)::int as n from device_app_usage_daily where day=current_date')).rows[0].n,7);
});
test('remote requests reject anonymous, teachers, devices and other-school admins',async()=>{
 for(const uid of [null,ids.teacher,ids.device,ids.adminB]) await assert.rejects(as(uid,"select staff_request_remote_control($1,'alarm','School support',true)",[ids.deviceA]),/permission|administrator|authorization/i);
});
test('alarm is scoped, audited, time-bounded, rejects missing authorization and excess duration',async()=>{
 const {device}=await fresh();
 await assert.rejects(request(device,'alarm',{authorized:false}),/authorization/);
 await assert.rejects(request(device,'alarm',{seconds:31}),/5 to 30/);
 await assert.rejects(request(device,'alarm',{reason:'no'}),/reason/);
 const id=await request(device);
 const c=(await as(ids.admin,'select * from commands where id=$1',[id]))[0];
 assert.equal(c.payload.duration_seconds,15);assert.equal(c.payload.visible,true);assert.equal(c.created_by,ids.admin);
 assert(new Date(c.payload.expires_at)-new Date(c.created_at)<=120000);
 assert.equal((await as(ids.admin,'select * from device_control_audit where device_id=$1',[device])).length,1);
 await assert.rejects(request(device),/one minute/);
 await assert.rejects(as(ids.admin,"update commands set payload=payload||'{\"duration_seconds\":3600}' where id=$1",[id]),/cannot be edited|permission denied/);
 await assert.rejects(db.query("update commands set payload=payload||'{\"duration_seconds\":3600}' where id=$1",[id]),/cannot be edited/);
 await db.query("update commands set status='succeeded' where id=$1",[id]);
 await assert.rejects(as(ids.admin,"update commands set status='pending' where id=$1",[id]),/replayed|permission denied/);
 await assert.rejects(db.query("update commands set status='pending' where id=$1",[id]),/replayed/);
});
test('direct inserts cannot bypass authorization/limits, change type, or select another school device',async()=>{
 const {device}=await fresh();
 await assert.rejects(as(ids.admin,"insert into commands(device_id,school_id,type,payload) values($1,$2,'alarm','{}')",[device,ids.schoolA]),/authorization/);
 await assert.rejects(as(ids.admin,"insert into commands(device_id,school_id,type,payload) values($1,$2,'alarm','{\"authorized\":true,\"reason\":\"School support\"}')",[ids.deviceBId,ids.schoolA]),/administrator/);
 const normal=(await as(ids.admin,"insert into commands(device_id,school_id,type,payload) values($1,$2,'message','{}') returning id",[device,ids.schoolA]))[0].id;
 await assert.rejects(as(ids.admin,"update commands set type='alarm' where id=$1",[normal]),/new authorized|permission denied/);
 await assert.rejects(db.query("update commands set type='alarm' where id=$1",[normal]),/new authorized/);
});
test('capture completion is separate: only own device may consent, then upload one private JPEG',async()=>{
 const {device,uid}=await fresh();const id=await request(device,'request_capture',{kind:'screenshot'});
 assert.equal((await as(ids.admin,'select state from remote_capture_sessions where command_id=$1',[id]))[0].state,'offered');
 for(const who of [null,ids.device,ids.admin,ids.adminB,ids.deviceB]) await assert.rejects(as(who,"select device_remote_capture($1,'consented')",[id]),/permission|device/i);
 const image='data:image/jpeg;base64,'+Buffer.from('ffd8ffe00000','hex').toString('base64');
 await assert.rejects(as(uid,"select device_remote_capture($1,'completed',$2)",[id,image]),/consent/);
 await as(uid,"select device_remote_capture($1,'consented')",[id]);
 await as(uid,"select device_remote_capture($1,'consented')",[id]); // retry does not extend consent
 await assert.rejects(as(uid,"select device_remote_capture($1,'completed','data:text/html;base64,AAAA')",[id]),/JPEG/);
 await as(uid,"select device_remote_capture($1,'completed',$2)",[id,image]);
 await as(uid,"select device_remote_capture($1,'completed',$2)",[id,image]); // idempotent duplicate
 assert.equal((await as(ids.admin,'select * from remote_capture_frames where command_id=$1',[id])).length,1);
 for(const who of [ids.adminB,ids.teacher,uid,ids.deviceB]) assert.equal((await as(who,'select * from remote_capture_frames where command_id=$1',[id])).length,0);
 await assert.rejects(as(uid,'insert into remote_capture_frames(command_id,device_id,school_id,image) values($1,$2,$3,$4)',[id,device,ids.schoolA,image]),/permission|row-level/);
 await db.query("update remote_capture_frames set expires_at=now()-interval '1 second' where command_id=$1",[id]);
 assert.equal((await as(ids.admin,'select * from remote_capture_frames where command_id=$1',[id])).length,0);
 await db.exec('select remote_control_internal.purge_expired_frames()');
 assert.equal((await db.query('select * from remote_capture_frames where command_id=$1',[id])).rows.length,0);
});
test('cancelled, expired and wrong-case capture requests are refused',async()=>{
 const a=await fresh();
 await assert.rejects(request(a.device,'request_capture',{kind:'video'}),/photo or screenshot/);
 const foreignCase=(await db.query("insert into device_cases(device_id,school_id,category,title) values($1,$2,'manual','Foreign case') returning id",[ids.deviceBId,ids.schoolB])).rows[0].id;
 await assert.rejects(request(a.device,'request_capture',{kind:'photo',caseId:foreignCase}),/case for this device/);
 const id=await request(a.device,'request_capture',{kind:'photo'});
 await db.query("update commands set status='cancelled' where id=$1",[id]);
 await assert.rejects(as(a.uid,"select device_remote_capture($1,'consented')",[id]),/not available/);
 const b=await fresh();const expired=await request(b.device,'request_capture',{kind:'photo'});
 await db.query("update remote_capture_sessions set expires_at=now()-interval '1 second' where command_id=$1",[expired]);
 await assert.rejects(as(b.uid,"select device_remote_capture($1,'consented')",[expired]),/expired/);
 for(const who of [ids.admin,ids.device,null]) await assert.rejects(as(who,'select remote_control_internal.purge_expired_frames()'),/permission/);
});
test('urgent fetch is device-only, skips bulk transfers, and preserves media command compatibility',async()=>{
 const {device,uid}=await fresh();
 await as(ids.admin,"insert into commands(device_id,school_id,type,payload) values($1,$2,'push_file','{}')",[device,ids.schoolA]);
 // Media command remains legal after both additive constraint migrations.
 await as(ids.admin,"insert into commands(device_id,school_id,type,payload) values($1,$2,'retrieve_file','{}')",[device,ids.schoolA]);
 const alarm=await request(device);
 for(const who of [null,ids.admin,ids.teacher,ids.adminB]) await assert.rejects(as(who,'select device_fetch_remote_controls()'),/permission|enrolled device/i);
 const result=(await as(uid,'select device_fetch_remote_controls() as result'))[0].result;
 assert.deepEqual(result.commands.map(c=>c.id),[alarm]);
 const other=(await as(ids.deviceB,'select device_fetch_remote_controls() as result'))[0].result;
 assert.equal(other.commands.length,0);
 assert.equal((await db.query("select count(*)::int as n from commands where device_id=$1 and type in ('push_file','retrieve_file') and status='pending'",[device])).rows[0].n,2);
 // Owner-only fixture simulates an old, unexecuted request without waiting two minutes.
 await db.transaction(async tx=>{
  await tx.exec('alter table commands disable trigger remote_control_guard');
  await tx.query("update commands set payload=jsonb_set(payload,'{expires_at}',to_jsonb((now()-interval '1 minute')::text)) where id=$1",[alarm]);
  await tx.exec('alter table commands enable trigger remote_control_guard');
 });
 assert.equal((await as(uid,'select device_fetch_remote_controls() as result'))[0].result.commands.length,0);
 assert.equal((await db.query('select status from commands where id=$1',[alarm])).rows[0].status,'failed');
});
