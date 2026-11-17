import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const migrationsDirectory=join(dirname(fileURLToPath(import.meta.url)),"..","migrations");
const migration=readFileSync(join(migrationsDirectory,"20261103170000_first_boot_setup_codes.sql"),"utf8");
const identityMigration=readFileSync(join(migrationsDirectory,"20261109164344_primeid_serial_and_student_class.sql"),"utf8");

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
  await db.exec(migration);await db.exec(identityMigration);return db;
}

async function as(db,user,sql,params=[]){return db.transaction(async tx=>{
  await tx.exec("set local role authenticated");await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
  return (await tx.query(sql,params)).rows;
})}

test("school admins issue one-time six-digit setup codes without storing plaintext",async()=>{
  const db=await database();
  const admin=(await db.query("insert into auth.users default values returning id")).rows[0].id;
  const stranger=(await db.query("insert into auth.users default values returning id")).rows[0].id;
  const school=(await db.query("insert into schools(name) values ('Pilot') returning id")).rows[0].id;
  await db.query("insert into managers values($1,$2)",[admin,school]);
  await assert.rejects(as(db,stranger,"select staff_issue_school_setup_code($1) result",[school]),/administrator access required/i);
  const issued=(await as(db,admin,"select staff_issue_school_setup_code($1) result",[school]))[0].result;
  assert.match(issued.code,/^[0-9]{6}$/);assert.ok(Date.parse(issued.expires_at)>Date.now());
  const stored=(await db.query("select code_hash,used_at,school_id from school_setup_codes where id=$1",[issued.id])).rows[0];
  assert.match(stored.code_hash,/^[0-9a-f]{64}$/);assert.notEqual(stored.code_hash,issued.code);assert.equal(stored.school_id,school);assert.equal(stored.used_at,null);
  await db.query(`insert into devices(school_id,student_name,prime_id,class_form,class_section)
    values($1,'Serial Student','PB03003150',1,'A')`,[school]);
  await assert.rejects(db.query(`insert into devices(school_id,student_name,prime_id,class_form,class_section)
    values($1,'Bad Class','PB03003151',7,'A')`,[school]),/check constraint/i);
  await db.close();
});
