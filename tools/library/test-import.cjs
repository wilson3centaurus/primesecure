// Meaningful transaction checks using the repository's PostgreSQL test engine.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {PGlite}=require('../../supabase/tests/node_modules/@electric-sql/pglite');
(async()=>{
 const school='14eea188-73b1-40bc-8f8d-15afbea27ffa';
 const fixture=[{id:'11111111-1111-1111-1111-111111111111',title:"Student's guide",description:'SCHOOL RECORDS attribution',form_level:'Form 1',subject:'Robotics',category:'Notes',storage_path:school+'/test.pdf',mime_type:'application/pdf',size:100,sha256:'a'.repeat(64),source_url:'https://example.org'}];
 const build=require('node:child_process').spawnSync('python',['-c',"import runpy,sys,json;sys.path.insert(0,'tools/library');d=runpy.run_path('tools/library/import-expansion.py');print(d['catalog_sql'](json.load(sys.stdin)))"],{input:JSON.stringify(fixture),encoding:'utf8'});
 assert.equal(build.status,0,build.stderr);
 const sql=process.argv[2]?fs.readFileSync(process.argv[2],'utf8'):build.stdout;
 const db=new PGlite();
 await db.exec(`create table hub_items(id uuid primary key,school_id uuid,kind text,title text,description text,form_level text,subject text,category text,storage_path text unique,mime_type text,size bigint,sha256 text,source_url text,published boolean,preinstall boolean);
 create table hub_access(item_id uuid,school_id uuid);
 create table hub_folders(school_id uuid,scope text,path text[],unique(scope,path));
 insert into hub_items values('22222222-2222-2222-2222-222222222222',null,'app','User app','keep','','','Apps','shared/keep.apk','apk',1,'existing',null,true,true);`);
 await db.exec(sql);await db.exec(sql);
 assert.equal((await db.query('select count(*)::int n from hub_items')).rows[0].n,2);
 assert.equal((await db.query('select count(*)::int n from hub_folders')).rows[0].n,3);
 assert.equal((await db.query("select title,description from hub_items where kind='resource'")).rows[0].title,"Student's guide");
 assert.equal((await db.query("select description from hub_items where kind='resource'")).rows[0].description,'SCHOOL RECORDS attribution');
 assert.equal((await db.query("select preinstall from hub_items where kind='app'")).rows[0].preinstall,true);
 // Publishing over the total cap must roll back the entire transaction.
 await db.exec("update hub_items set size=1000000001 where kind='resource'");
 await assert.rejects(db.exec(sql),/budget exceeded/);await db.exec('rollback');
 assert.equal((await db.query('select count(*)::int n from hub_items')).rows[0].n,2);
 await db.close();console.log('PASS: atomic seed, idempotent rerun, folder ancestry, existing app preserved, 1GB budget rollback.');
})().catch(e=>{console.error(e);process.exit(1)});
