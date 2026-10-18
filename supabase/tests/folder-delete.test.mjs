import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite(),ids={};
async function as(uid,sql,params=[]){return db.transaction(async tx=>{await tx.exec(`set local role ${uid?'authenticated':'anon'}`);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uid||'']);return (await tx.query(sql,params)).rows;});}
async function resource(school,form,subject,kind='resource',path){return (await db.query('insert into hub_items(kind,school_id,title,storage_path,size,form_level,subject,category,package_name) values($1,$2,$3,$4,10,$5,$6,$7,$8) returning id',[kind,school,subject,path||`${school||'shared'}/${Math.random()}.jpg`,form,subject,'',kind==='app'?'org.example.test':null])).rows[0].id;}
before(async()=>{
 const baseline=readFileSync(new URL('./rls.test.mjs',import.meta.url),'utf8');await db.exec(baseline.match(/const SUPABASE_STUB = `([\s\S]*?)`;/)[1]);
 await db.exec('alter table storage.buckets add column file_size_limit bigint');
 const directory=new URL('../migrations/',import.meta.url);
 for(const file of readdirSync(directory).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(file,directory),'utf8').replace(/^\uFEFF/,''));
 for(const key of ['super','admin','teacher','device'])ids[key]=(await db.query('insert into auth.users(email) values($1) returning id',[key+'@folders.test'])).rows[0].id;
 for(const key of ['a','b'])ids[key]=(await db.query('insert into schools(name) values($1) returning id',[key])).rows[0].id;
 await db.query("insert into profiles(id,role,school_id) values($1,'super_admin',null),($2,'school_admin',$4),($3,'teacher',$4)",[ids.super,ids.admin,ids.teacher,ids.a]);
 await db.query("insert into devices(school_id,auth_user_id,status) values($1,$2,'active')",[ids.a,ids.device]);
});
after(()=>db.close());
test('recursive deletion removes selected nested folders and files, preserving other schools, sibling folders and apps',async()=>{
 const local=await resource(ids.a,'Explore & grow','Robotics');const other=await resource(ids.b,'Explore & grow','Robotics');const sibling=await resource(ids.a,'Maths','Algebra');const app=await resource(ids.a,'Explore & grow','Robotics','app');
 await db.query('insert into hub_folders(school_id,scope,path) values($1,$2,$3),($1,$2,$4)',[ids.a,ids.a,['Explore & grow'],['Explore & grow','Robotics']]);
 const result=(await as(ids.admin,'select staff_delete_library_folders($1,false,$2::jsonb) as result',[ids.a,JSON.stringify([['Explore & grow']])]))[0].result;
 assert.equal(result.files,1);assert.equal(result.folders,2);assert.equal(result.storage_paths.length,1);
 const remaining=(await db.query('select id from hub_items')).rows.map(r=>r.id);assert(!remaining.includes(local));for(const id of [other,sibling,app])assert(remaining.includes(id));
});
test('all authorization failures happen without deleting resources',async()=>{
 const id=await resource(null,'Protected','Shared');
 for(const [who,school,shared] of [[ids.admin,ids.b,false],[ids.admin,ids.a,true],[ids.teacher,ids.a,false],[ids.device,ids.a,false],[null,ids.a,false]])
  await assert.rejects(as(who,'select staff_delete_library_folders($1,$2,$3::jsonb)',[school,shared,JSON.stringify([['Protected']])]),/access|permission/i);
 assert.equal((await db.query('select id from hub_items where id=$1',[id])).rows.length,1);
});
test('multi-folder deletion handles overlapping selections once and preserves sibling resources',async()=>{
 const path=ids.a+'/same/object.jpg';await resource(ids.a,'Batch','One','resource',path);await resource(ids.a,'Batch','Two');const kept=await resource(ids.a,'Kept','Other');
 const result=(await as(ids.admin,'select staff_delete_library_folders($1,false,$2::jsonb) as result',[ids.a,JSON.stringify([['Batch'],['Batch','One']])]))[0].result;
 assert.equal(result.files,2);assert.equal(result.storage_paths.length,2);assert(result.storage_paths.includes(path));assert.equal((await db.query('select id from hub_items where id=$1',[kept])).rows.length,1);
});
test('invalid root, shape, names and oversize selections are rejected',async()=>{
 for(const paths of [[],[[]],[['..','bad/name']],[['a','b','c','d']],Array(101).fill(['a']),[['a',null]]])
  await assert.rejects(as(ids.admin,'select staff_delete_library_folders($1,false,$2::jsonb)',[ids.a,JSON.stringify(paths)]),/folder/i);
});
test('super administrator can remove shared resources without touching school resources',async()=>{
 const id=await resource(null,'Delete shared','One');const local=await resource(ids.a,'Delete shared','One');
 const result=(await as(ids.super,'select staff_delete_library_folders($1,true,$2::jsonb) as result',[ids.a,JSON.stringify([['Delete shared']])]))[0].result;
 assert.equal(result.files,1);assert.equal((await db.query('select id from hub_items where id=$1',[id])).rows.length,0);assert.equal((await db.query('select id from hub_items where id=$1',[local])).rows.length,1);
});
