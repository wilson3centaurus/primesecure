import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const dir=join(dirname(fileURLToPath(import.meta.url)),"..","migrations");
const read=(f)=>readFileSync(join(dir,f),"utf8");

async function database(){
  const db=new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema extensions;
    create function extensions.digest(value text,algorithm text) returns bytea language sql immutable as $$
      select decode(md5(value)||md5(reverse(value)),'hex')
    $$;
    create table auth.users(id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table schools(id uuid primary key default gen_random_uuid(),name text not null);
    create table managers(user_id uuid not null,school_id uuid not null);
    create function can_manage_school(wanted uuid) returns boolean language sql stable as $$
      select exists(select 1 from public.managers where user_id=auth.uid() and school_id=wanted)
    $$;
    create function touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now();return new;end $$;
    create table devices(id uuid primary key default gen_random_uuid(),school_id uuid references schools(id),student_name text,
      serial text,prime_id text,android_id text,model text,status text not null default 'pending',created_at timestamptz not null default now());
    create table device_setup_requests(id uuid primary key default gen_random_uuid(),prime_id text);
    grant usage on schema public to anon,authenticated,service_role;
  `);
  await db.exec(read("20261103170000_first_boot_setup_codes.sql"));
  await db.exec(read("20261109164344_primeid_serial_and_student_class.sql"));
  await db.exec(read("20261110120000_setup_code_ttl.sql"));
  return db;
}

async function as(db,role,user,sql,params=[]){return db.transaction(async tx=>{
  await tx.exec(`set local role ${role}`);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user??""]);
  return (await tx.query(sql,params)).rows;
})}
const secs=(r)=>(Date.parse(r.expires_at)-Date.now())/1000;

test("authenticator codes: admin-only, short-lived, clamped, and old rows cleaned",async()=>{
  const db=await database();
  const admin=(await db.query("insert into auth.users default values returning id")).rows[0].id;
  const stranger=(await db.query("insert into auth.users default values returning id")).rows[0].id;
  const school=(await db.query("insert into schools(name) values ('Pilot') returning id")).rows[0].id;
  await db.query("insert into managers values($1,$2)",[admin,school]);
  const issue=(who,ttl)=>as(db,"authenticated",who,"select staff_issue_school_setup_code($1,$2) result",[school,ttl]).then(r=>r[0].result);

  await assert.rejects(issue(stranger,30),/administrator access required/i);
  await assert.rejects(as(db,"anon",null,"select staff_issue_school_setup_code($1,30) result",[school]),/permission denied/i);

  const short=await issue(admin,30);
  assert.match(short.code,/^[0-9]{6}$/);
  assert.ok(secs(short)>25&&secs(short)<=31,`30s code expires in ${secs(short)}s`);
  const row=(await db.query("select code_hash,expires_at from school_setup_codes where id=$1",[short.id])).rows[0];
  assert.notEqual(row.code_hash,short.code);
  assert.equal(new Date(row.expires_at).getTime(),Date.parse(short.expires_at),"stored expiry is what device-setup enforces");

  assert.ok(secs(await issue(admin,1))<=16,"minimum lifetime is 15s");
  assert.ok(secs(await issue(admin,99999))<=901,"maximum lifetime is 15 minutes");

  // Dashboard's original one-argument function still issues 15-minute codes.
  const legacy=(await as(db,"authenticated",admin,"select staff_issue_school_setup_code($1) result",[school]))[0].result;
  assert.ok(secs(legacy)>800);

  // Long-expired unclaimed codes are purged; claimed or used ones are kept.
  await db.query(`insert into school_setup_codes(school_id,code_hash,expires_at,claimed_at,used_at) values
    ($1,repeat('a',64),now()-interval '2 hours',null,null),
    ($1,repeat('b',64),now()-interval '2 hours',now()-interval '2 hours',null),
    ($1,repeat('c',64),now()-interval '2 hours',null,now()-interval '2 hours'),
    ($1,repeat('d',64),now()-interval '5 minutes',null,null)`,[school]);
  await issue(admin,30);
  const left=(await db.query("select left(code_hash,1) h from school_setup_codes where code_hash ~ '^(a|b|c|d)+$' order by 1")).rows.map(r=>r.h);
  assert.deepEqual(left,["b","c","d"]);
  await db.close();
});
