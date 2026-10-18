import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db=new PGlite(),ids={};
async function as(uid,sql,params=[]){return db.transaction(async tx=>{await tx.exec(`set local role ${uid?'authenticated':'anon'}`);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uid||'']);return (await tx.query(sql,params)).rows;});}
async function item(kind,school,title){return (await db.query('insert into hub_items(kind,school_id,title,storage_path,size,package_name) values($1,$2,$3,$4,100,$5) returning id',[kind,school,title,`${school||'shared'}/${title}.png`,kind==='app'?'org.example.qa':null])).rows[0].id;}
before(async()=>{
 const baseline=readFileSync(new URL('./rls.test.mjs',import.meta.url),'utf8');
 const stub=baseline.match(/const SUPABASE_STUB = `([\s\S]*?)`;/)[1];await db.exec(stub);
 await db.exec('alter table storage.buckets add column file_size_limit bigint');
 const dir=new URL('../migrations/',import.meta.url),files=readdirSync(dir).filter(f=>f.endsWith('.sql')).sort();
 const latest=files.find(f=>f.endsWith('_wallpaper_automatic_availability.sql'));
 for(const f of files.filter(f=>f!==latest)){try{await db.exec(readFileSync(new URL(f,dir),'utf8').replace(/^\uFEFF/,''));}catch(e){throw new Error(f+': '+e.message);}}
 for(const key of ['super','admin','teacher','device','deviceB'])ids[key]=(await db.query('insert into auth.users(email) values($1) returning id',[key+'@wallpaper.test'])).rows[0].id;
 ids.a=(await db.query("insert into schools(name) values('Wallpaper A') returning id")).rows[0].id;
 ids.b=(await db.query("insert into schools(name) values('Wallpaper B') returning id")).rows[0].id;
 await db.query("insert into profiles(id,role,school_id) values($1,'super_admin',null),($2,'school_admin',$4),($3,'teacher',$4)",[ids.super,ids.admin,ids.teacher,ids.a]);
 await db.query("insert into devices(school_id,auth_user_id,status) values($1,$2,'active'),($3,$4,'active')",[ids.a,ids.device,ids.b,ids.deviceB]);
 ids.old=await item('wallpaper',null,'old-shared');await db.query('update hub_items set published=false where id=$1',[ids.old]);
 ids.oldLocal=await item('wallpaper',ids.a,'old-local');await db.query('update hub_items set published=false where id=$1',[ids.oldLocal]);
 ids.app=await item('app',null,'opt-in-app');ids.note=await item('resource',null,'opt-in-note');
 await db.exec(readFileSync(new URL(latest,dir),'utf8').replace(/^\uFEFF/,''));
});
after(()=>db.close());
test('migration enables existing wallpapers but not shared apps or notes',async()=>{
 for(const who of ['device','deviceB']){const rows=await as(ids[who],'select id from hub_items');assert(rows.some(r=>r.id===ids.old));assert(!rows.some(r=>r.id===ids.app||r.id===ids.note));}
 assert((await as(ids.device,'select id from hub_items')).some(r=>r.id===ids.oldLocal));assert(!(await as(ids.deviceB,'select id from hub_items')).some(r=>r.id===ids.oldLocal));
});
test('new shared wallpapers appear in both device sync lists without opt-in',async()=>{
 const id=(await as(ids.super,"insert into hub_items(kind,title,storage_path,size,published) values('wallpaper','new shared','shared/new.jpg',100,false) returning id,published"))[0];assert.equal(id.published,true);
 for(const who of ['device','deviceB']){const result=(await as(ids[who],'select device_hub() as hub'))[0].hub;assert(result.items.some(r=>r.id===id.id));assert.equal((await as(ids[who],'select hub_can_read($1) as ok',[id.id]))[0].ok,true);}
});
test('new schools automatically receive shared wallpaper access',async()=>{
 const id=(await as(ids.super,"insert into schools(name) values('Wallpaper C') returning id"))[0].id;
 const grants=await db.query('select item_id from hub_access where school_id=$1',[id]);assert(grants.rows.some(r=>r.item_id===ids.old));assert(!grants.rows.some(r=>r.item_id===ids.app||r.item_id===ids.note));
});
test('school uploads stay in their school; teachers and anonymous users cannot upload',async()=>{
 const id=(await as(ids.admin,"insert into hub_items(kind,school_id,title,storage_path,size) values('wallpaper',$1,'local',$2,100) returning id",[ids.a,ids.a+'/new-local.jpg']))[0].id;
 assert.equal((await as(ids.device,'select hub_can_read($1) as ok',[id]))[0].ok,true);assert.equal((await as(ids.deviceB,'select hub_can_read($1) as ok',[id]))[0].ok,false);
 for(const who of [ids.teacher,null])await assert.rejects(as(who,"insert into hub_items(kind,title,storage_path,size) values('wallpaper','bad','shared/bad.jpg',100)"),/permission|row-level/i);
});
test('deletion removes access and selected defaults; school admins cannot delete shared wallpapers',async()=>{
 const denied=await as(ids.admin,'delete from hub_items where id=$1 returning id',[ids.old]);assert.equal(denied.length,0);
 await as(ids.super,"insert into hub_settings(scope,default_wallpaper_id) values('global',$1)",[ids.old]);
 await as(ids.super,'delete from hub_items where id=$1',[ids.old]);assert.equal((await db.query('select * from hub_access where item_id=$1',[ids.old])).rows.length,0);assert.equal((await db.query("select default_wallpaper_id from hub_settings where scope='global'")).rows[0].default_wallpaper_id,null);
 assert.equal((await as(ids.device,'select hub_can_read($1) as ok',[ids.old]))[0].ok,false);
});
test('trigger helpers cannot be executed through an authenticated or anonymous session',async()=>{
 for(const who of [ids.admin,null])await assert.rejects(as(who,'select wallpaper_internal.share_uploaded_wallpaper()'),/permission denied/);
});
