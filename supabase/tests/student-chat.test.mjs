import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");
const rlsSource = readFileSync(join(here, "rls.test.mjs"), "utf8");
const supabaseStub = rlsSource.match(/const SUPABASE_STUB = `([\s\S]*?)`;/)?.[1];

if (!supabaseStub) throw new Error("Could not load the shared Supabase test stub");

async function signedIn(db, uid, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    await tx.query("select set_config('request.headers', $1, true)", [
      '{"x-forwarded-for":"41.57.10.20"}',
    ]);
    return (await tx.query(sql, params)).rows;
  });
}

async function action(db, uid, requestId, name, payload) {
  const [row] = await signedIn(
    db,
    uid,
    "select primesecure.device_offline_action($1, $2, $3) result",
    [requestId, name, payload],
  );
  return row.result;
}

test("student chat enforces friendship, blocking, school isolation and admin oversight", async () => {
  const db = new PGlite();
  await db.exec(supabaseStub);
  await db.exec("create role authenticator nologin");
  await db.exec("alter table storage.buckets add column file_size_limit bigint");
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(migrationsDir, file), "utf8").replace(/^\uFEFF/, ""));
  }

  const ids = {};
  for (const key of ["adminA", "adminB", "aliceAuth", "bobAuth", "otherAuth"]) {
    ids[key] = (
      await db.query("insert into auth.users(email) values ($1) returning id", [`${key}@test.local`])
    ).rows[0].id;
  }
  ids.schoolA = (await db.query("insert into schools(name) values ('Chat School') returning id")).rows[0].id;
  ids.schoolB = (await db.query("insert into schools(name) values ('Other School') returning id")).rows[0].id;
  await db.query(
    "insert into profiles(id, school_id, role) values ($1,$3,'school_admin'),($2,$4,'school_admin')",
    [ids.adminA, ids.adminB, ids.schoolA, ids.schoolB],
  );

  for (const [key, authKey, school] of [
    ["alice", "aliceAuth", ids.schoolA],
    ["bob", "bobAuth", ids.schoolA],
    ["other", "otherAuth", ids.schoolB],
  ]) {
    ids[key] = (
      await db.query(
        "insert into devices(school_id,student_name,auth_user_id,status) values ($1,$2,$3,'active') returning id",
        [school, key, ids[authKey]],
      )
    ).rows[0].id;
    await db.query(
      "insert into student_records(device_id,dob,home_address,mother_phone,username,profile_photo) values ($1,'2012-01-01','Test address','0770000000',$2,$3)",
      [ids[key], key === "alice" ? "Alice" : key === "bob" ? "Bobby" : "Boris", `data:image/jpeg;base64,${key}`],
    );
  }

  const [directoryRow] = await signedIn(
    db,
    ids.aliceAuth,
    "select primesecure.device_chat_directory('bo', 20) directory",
  );
  assert.deepEqual(directoryRow.directory.profiles.map((profile) => profile.username), ["Bobby"]);
  assert.deepEqual(Object.keys(directoryRow.directory.profiles[0]).sort(), [
    "device_id",
    "profile_photo",
    "relationship",
    "request_id",
    "username",
  ]);

  const requestId = randomUUID();
  const requested = await action(db, ids.aliceAuth, requestId, "chat_request", { device_id: ids.bob });
  const replayed = await action(db, ids.aliceAuth, requestId, "chat_request", { device_id: ids.bob });
  assert.equal(replayed.request_id, requested.request_id);
  assert.equal((await db.query("select count(*)::int count from primesecure.student_friend_requests")).rows[0].count, 1);

  await action(db, ids.bobAuth, randomUUID(), "chat_respond", {
    request_id: requested.request_id,
    response: "accepted",
  });
  const [contact] = (await db.query("select id from primesecure.student_contacts")).rows;
  const sent = await action(db, ids.aliceAuth, randomUUID(), "chat_send", {
    contact_id: contact.id,
    body: "Hello Bobby",
    image: "data:image/jpeg;base64,not-stored",
  });
  assert.ok(sent.id);

  const [bobHub] = await signedIn(db, ids.bobAuth, "select primesecure.device_chat_hub() hub");
  assert.equal(bobHub.hub.contacts[0].username, "Alice");
  assert.equal(bobHub.hub.contacts[0].unread, 1);
  assert.equal(bobHub.hub.messages[0].body, "Hello Bobby");
  assert.equal(Object.hasOwn(bobHub.hub.messages[0], "image"), false);

  assert.equal((await signedIn(db, ids.adminA, "select * from primesecure.student_chat_messages")).length, 1);
  assert.equal((await signedIn(db, ids.adminA, "select * from primesecure.student_friend_requests")).length, 1);
  assert.equal((await signedIn(db, ids.adminB, "select * from primesecure.student_chat_messages")).length, 0);

  await action(db, ids.bobAuth, randomUUID(), "chat_block", { device_id: ids.alice });
  await assert.rejects(
    action(db, ids.aliceAuth, randomUUID(), "chat_send", {
      contact_id: contact.id,
      body: "This must be blocked",
    }),
    /Chat contact unavailable/,
  );
  await assert.rejects(
    signedIn(
      db,
      ids.aliceAuth,
      "insert into primesecure.student_chat_messages(contact_id,school_id,sender_device_id,recipient_device_id,body) values ($1,$2,$3,$4,'bypass')",
      [contact.id, ids.schoolA, ids.alice, ids.bob],
    ),
    /permission denied/,
  );

  await db.close();
});
