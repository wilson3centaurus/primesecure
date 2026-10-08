// Device enrollment. Called by the agent (with the anon key) before it has an
// account of its own:
//
//   POST /functions/v1/enroll
//   { "token": "K7QF-M2XP", "android_id": "...", "serial": "...", "model": "...", "manufacturer": "..." }
//
// Exchanges a valid, unexpired enroll token for a dedicated auth user for the
// device. The agent signs in with the returned credentials, and from then on
// RLS scopes it to its own device row. The token is single-use.

import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const TOKEN_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "");
}

function text(value: unknown, max = 200): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const token = text(body.token, 9)?.toUpperCase().replace(/[IL]/g, "1").replace(/O/g, "0");
  if (!token || !TOKEN_PATTERN.test(token)) return json(400, { error: "invalid_token" });

  const { data: device, error: lookupError } = await admin
    .from("devices")
    .select("id, school_id, status, auth_user_id, enroll_token_expires_at")
    .eq("enroll_token", token)
    .maybeSingle();

  if (lookupError) return json(500, { error: "lookup_failed" });
  if (!device || device.status === "retired") return json(404, { error: "unknown_token" });
  if (device.enroll_token_expires_at && new Date(device.enroll_token_expires_at) < new Date()) {
    return json(410, { error: "token_expired" });
  }

  // Burn the token before anything else so two racing requests can't both win.
  const { data: claimed, error: claimError } = await admin
    .from("devices")
    .update({ enroll_token: null, enroll_token_expires_at: null })
    .eq("id", device.id)
    .eq("enroll_token", token)
    .select("id");
  if (claimError || !claimed?.length) return json(409, { error: "token_already_used" });

  // Re-enrolling (factory reset, reinstall): the old device account goes away.
  if (device.auth_user_id) {
    await admin.auth.admin.deleteUser(device.auth_user_id);
  }

  const email = `${device.id}@devices.primesecure.invalid`;
  const password = randomPassword();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { kind: "device", device_id: device.id, school_id: device.school_id },
  });
  if (createError || !created.user) {
    return json(500, { error: "account_create_failed", detail: createError?.message });
  }

  const { error: linkError } = await admin
    .from("devices")
    .update({
      auth_user_id: created.user.id,
      enrolled_at: new Date().toISOString(),
      android_id: text(body.android_id),
      serial: text(body.serial),
      model: text(body.model),
      manufacturer: text(body.manufacturer),
    })
    .eq("id", device.id);
  if (linkError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json(500, { error: "link_failed" });
  }

  return json(200, {
    device_id: device.id,
    school_id: device.school_id,
    email,
    password,
  });
});
