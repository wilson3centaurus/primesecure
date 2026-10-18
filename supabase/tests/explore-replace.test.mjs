import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),school='14eea188-73b1-40bc-8f8d-15afbea27ffa';let other,old,kept;
function sql(rows,baseline){return execFileSync('python',['-c',"import importlib.util,json,sys;sys.path.insert(0,'tools/library');s=importlib.util.spec_from_file_location('replacement','tools/library/replace-explore-server.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);p=json.load(sys.stdin);print(m.replacement_sql(p['rows'],p['baseline']))"],{cwd:fileURLToPath(new URL('../../',import.meta.url)),input:JSON.stringify({rows,baseline}),encoding:'utf8'});}
async function snapshot(){return (await db.query("select to_jsonb(i) as row from hub_items i where school_id=$1 and kind='resource' and form_level='Explore & grow' order by id",[school])).rows.map(r=>r.row);}
function row(id,subject,path){return {id,form_level:'Explore & grow',subject,category:'',title:subject,description:'School image',storage_path:school+'/explore/'+path+'.jpg',mime_type:'image/jpeg',size:100,sha256:'a'.repeat(64)};}
before(async()=>{
 const stub=readFileSync(new URL('./rls.test.mjs',import.meta.url),'utf8').match(/const SUPABASE_STUB = `([\s\S]*?)`;/)[1];await db.exec(stub);await db.exec('alter table storage.buckets add column file_size_limit bigint');
 const directory=new URL('../migrations/',import.meta.url);
 for(const file of readdirSync(directory).filter(f=>f.endsWith('.sql')&&f<='20261018230850_library_folder_upload_delete.sql').sort())await db.exec(readFileSync(new URL(file,directory),'utf8').replace(/^\uFEFF/,''));
 await db.query("insert into schools(id,name) values($1,'Rusununguko ZIMFEP High School')",[school]);other=(await db.query("insert into schools(name) values('Other') returning id")).rows[0].id;
 old=(await db.query("insert into hub_items(school_id,kind,title,form_level,subject,storage_path,size) values($1,'resource','Old guide','Explore & grow','Old',$2,10) returning id",[school,school+'/old.png'])).rows[0].id;
 kept=(await db.query("insert into hub_items(school_id,kind,title,form_level,subject,storage_path,size) values($1,'resource','Keep maths','Maths','Algebra',$2,10) returning id",[school,school+'/keep.pdf'])).rows[0].id;
 await db.query("insert into hub_items(school_id,kind,title,form_level,subject,storage_path,size) values($1,'resource','Other school guide','Explore & grow','Old',$2,10)",[other,other+'/old.png']);
});
after(()=>db.close());
test('replacement preserves parent and exact subject folders, including apostrophes; other resources and schools survive',async()=>{
 const rows=[row('11111111-1111-4111-8111-111111111111','Robotics','robot'),row('22222222-2222-4222-8222-222222222222',"Today's world",'world')];
 await db.exec(sql(rows,await snapshot()));assert.equal((await snapshot()).length,2);
 assert.equal((await db.query('select id from hub_items where id=$1',[old])).rows.length,0);assert.equal((await db.query('select id from hub_items where id=$1',[kept])).rows.length,1);
 assert.equal((await db.query('select id from hub_items where school_id=$1',[other])).rows.length,1);
 const folders=(await db.query('select path from hub_folders where school_id=$1',[school])).rows.map(r=>r.path);
 for(const path of [['Explore & grow'],['Explore & grow','Robotics'],['Explore & grow',"Today's world"]])assert(folders.some(p=>JSON.stringify(p)===JSON.stringify(path)));
});
test('an invalid replacement rolls back all removals and additions',async()=>{
 const baseline=await snapshot(),bad=row('33333333-3333-4333-8333-333333333333','Physics','bad');bad.storage_path='shared/wrong.jpg';
 await assert.rejects(db.exec(sql([bad],baseline)),/scope|constraint/i);await db.exec('rollback');assert.deepEqual(await snapshot(),baseline);
});
test('new edits after backup cancel replacement rather than destroying them',async()=>{
 const baseline=await snapshot();await db.query('update hub_items set title=$1 where id=$2',['New staff title',baseline[0].id]);
 await assert.rejects(db.exec(sql([],baseline)),/changed after backup/i);await db.exec('rollback');assert.equal((await snapshot()).length,2);
});
