import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const migrationsDirectory=join(dirname(fileURLToPath(import.meta.url)),"..","migrations");
const migration=readFileSync(join(migrationsDirectory,"20261029065844_device_setup_requests.sql"),"utf8");
const identityMigration=readFileSync(join(migrationsDirectory,"20261109164344_primeid_serial_and_student_class.sql"),"utf8");
const setupFunction=readFileSync(join(dirname(fileURLToPath(import.meta.url)),"..","functions","device-setup","index.ts"),"utf8");

test("verified existing assignments receive an enrollment token in the verification response",()=>{
  assert.match(setupFunction,/activateVerifiedSession/);
  assert.match(setupFunction,/enroll_token:token/);
  assert.match(setupFunction,/if\(device\).*activateVerifiedSession/s);
});

async function database(){
  const db=new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create table schools(id uuid primary key default gen_random_uuid(),name text not null);
    create table managers(user_id uuid not null,school_id uuid not null);
    create function can_manage_school(wanted uuid) returns boolean language sql stable as $$
      select exists(select 1 from public.managers where user_id=auth.uid() and school_id=wanted)
    $$;
    create function is_super_admin() returns boolean language sql stable as $$ select false $$;
    create function touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now();return new;end $$;
    create table devices(
      id uuid primary key default gen_random_uuid(),school_id uuid references schools(id),student_name text,
      model text,serial text,android_id text,prime_id text,status text not null default 'pending',
      enroll_token text default 'ABCD-EFGH',enroll_token_expires_at timestamptz default now()+interval '7 days'
    );
    create table first_boot_sessions(id uuid primary key default gen_random_uuid(),prime_id text);
    grant usage on schema public to anon,authenticated,service_role;
    grant select on schools,devices to authenticated;
  `);
  await db.exec(migration);
  await db.exec(identityMigration);
  return db;
}

async function as(db,user,sql,params=[]){
  return db.transaction(async tx=>{
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
    return (await tx.query(sql,params)).rows;
  });
}

test("device setup approval is staff scoped and creates a pending device",async()=>{
  const db=await database();
  const admin=(await db.query("insert into auth.users default values returning id")).rows[0].id;
  const stranger=(await db.query("insert into auth.users default values returning id")).rows[0].id;
  const school=(await db.query("insert into schools(name) values ('Pilot') returning id")).rows[0].id;
  await db.query("insert into managers values($1,$2)",[admin,school]);
  const request=(await db.query(`insert into device_setup_requests
    (request_secret_hash,verification_code,school_id,student_name,phone_e164,region,prime_id)
    values($1,'042817',$2,'Test Student','+263771234567','Harare','PB03003150') returning id`,["a".repeat(64),school])).rows[0].id;

  await assert.rejects(as(db,stranger,"select staff_approve_device_setup($1,$2)",[request,school]),/administrator access required/i);
  const approved=await as(db,admin,"select staff_approve_device_setup($1,$2) result",[request,school]);
  assert.equal(approved[0].result.status,"approved");
  assert.equal(approved[0].result.enroll_token,"ABCD-EFGH");
  const row=(await db.query("select status,device_id,verification_code from device_setup_requests where id=$1",[request])).rows[0];
  assert.equal(row.status,"approved");
  assert.equal(row.verification_code,"042817");
  assert.ok(row.device_id);
  const device=(await db.query("select status,prime_id from devices where id=$1",[row.device_id])).rows[0];
  assert.equal(device.status,"pending");
  assert.equal(device.prime_id,"PB03003150");
  await db.close();
});

test("setup request accepts serial Prime IDs and rejects weak secrets, malformed codes, phones and short IDs",async()=>{
  const db=await database();
  const school=(await db.query("insert into schools(name) values ('Pilot') returning id")).rows[0].id;
  for(const [column,value] of [["request_secret_hash","short"],["verification_code","123"],["phone_e164","0771234567"],["prime_id","X"]]){
    await assert.rejects(db.query(`insert into device_setup_requests
      (request_secret_hash,verification_code,school_id,student_name,phone_e164,region,prime_id)
      values($1,$2,$3,'Test Student',$4,'Harare',$5)`,[
        column==="request_secret_hash"?value:"b".repeat(64),column==="verification_code"?value:"123456",school,
        column==="phone_e164"?value:"+263771234567",column==="prime_id"?value:"PB03003150"
      ]),/check constraint/i);
  }
  await db.query(`insert into device_setup_requests
    (request_secret_hash,verification_code,school_id,student_name,phone_e164,region,prime_id)
    values($1,'123456',$2,'Serial Student','+263771234567','Harare','PB03003150')`,["c".repeat(64),school]);
  await assert.rejects(db.query("insert into devices(student_name,prime_id,class_form,class_section) values('Student','PB-1',0,'A')"),/check constraint/i);
  await assert.rejects(db.query("insert into devices(student_name,prime_id,class_form,class_section) values('Student','PB-2',1,'1')"),/check constraint/i);
  await db.query("insert into devices(student_name,prime_id,class_form,class_section) values('Student','PB-3',6,'Z')");
  await db.close();
});
