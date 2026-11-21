#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

EXPECTED_SCHOOL_ID="14eea188-73b1-40bc-8f8d-15afbea27ffa"
EXPECTED_SCHOOL_NAME="Rusununguko ZIMFEP High School"
DB_CONTAINER="supabase-db"
EDGE_CONTAINER="supabase-edge-functions"
API_URL="${PRIMESECURE_API_URL:-https://api.robokorda.duckdns.org}"
BUNDLE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PSQL=(docker exec -i "$DB_CONTAINER" psql -X -q -A -t -v ON_ERROR_STOP=1 -U supabase_admin -d postgres)

fail(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
command -v docker >/dev/null || fail "docker is unavailable"
command -v sha256sum >/dev/null || fail "sha256sum is unavailable"
command -v curl >/dev/null || fail "curl is unavailable"
[[ "$(id -u)" == "0" ]] || fail "run this script as root"
[[ -f "$BUNDLE_DIR/SHA256SUMS" ]] || fail "SHA256SUMS is missing from the bundle"
(cd "$BUNDLE_DIR" && sha256sum -c SHA256SUMS)

docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || fail "$DB_CONTAINER is not present"
docker inspect "$EDGE_CONTAINER" >/dev/null 2>&1 || fail "$EDGE_CONTAINER is not present"
[[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER")" == "true" ]] || fail "$DB_CONTAINER is not running"
[[ "$(docker inspect -f '{{.State.Running}}' "$EDGE_CONTAINER")" == "true" ]] || fail "$EDGE_CONTAINER is not running"

school="$("${PSQL[@]}" -c "select coalesce((select name from public.schools where id='$EXPECTED_SCHOOL_ID'),'')")"
[[ "$school" == "$EXPECTED_SCHOOL_NAME" ]] || fail "backend identity mismatch; found school '$school'"

functions_root="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/home/deno/functions"}}{{.Source}}{{end}}{{end}}' "$EDGE_CONTAINER")"
[[ -n "$functions_root" && -d "$functions_root" ]] || fail "could not resolve the Edge Functions bind mount"
[[ -f "$functions_root/main/index.ts" ]] || fail "unexpected functions layout: main/index.ts is absent"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/root/primesecure-backups/device-setup-$stamp"
health_body="$(mktemp)"
migration_sql="$(mktemp)"
trap 'rm -f "$health_body" "$migration_sql"' EXIT
install -d -m 700 "$backup/functions"
docker exec "$DB_CONTAINER" pg_dump -U supabase_admin -d postgres --schema-only --schema public --schema storage > "$backup/schema-before.sql"
chmod 600 "$backup/schema-before.sql"
for name in enroll device-setup; do
  if [[ -d "$functions_root/$name" ]]; then cp -a "$functions_root/$name" "$backup/functions/$name"; fi
done

request_exists="$("${PSQL[@]}" -c "select to_regclass('public.device_setup_requests') is not null")"
codes_exists="$("${PSQL[@]}" -c "select to_regclass('public.school_setup_codes') is not null")"
sessions_exists="$("${PSQL[@]}" -c "select to_regclass('public.first_boot_sessions') is not null")"
[[ "$codes_exists" == "$sessions_exists" ]] || fail "partial first-boot schema found; refusing an ambiguous repair"
[[ "$("${PSQL[@]}" -c "select to_regprocedure('extensions.digest(text,text)') is not null")" == "t" ]] || fail "extensions.digest(text,text) is unavailable"

migration_states=()
{
  printf 'begin;\n'
  printf "select pg_advisory_xact_lock(hashtext('primesecure-device-setup'));\n"
  if [[ "$request_exists" == "f" ]]; then
    cat "$BUNDLE_DIR/20261029065844_device_setup_requests.sql"
    printf '\n'
    migration_states+=("device-requests-applied")
  else
    migration_states+=("device-requests-present")
  fi
  if [[ "$codes_exists" == "f" ]]; then
    cat "$BUNDLE_DIR/20261103170000_first_boot_setup_codes.sql"
    printf '\n'
    migration_states+=("first-boot-applied")
  else
    migration_states+=("first-boot-present")
  fi
  cat "$BUNDLE_DIR/20261109164344_primeid_serial_and_student_class.sql"
  printf '\n'
  cat "$BUNDLE_DIR/20261121120000_backfill_first_boot_student_class.sql"
  printf '\n'
  cat "$BUNDLE_DIR/20261121173000_staff_support_delivery_receipts.sql"
  printf '\ncommit;\n'
  migration_states+=("serial-class-normalized" "dashboard-class-backfilled" "support-receipts-scoped")
} > "$migration_sql"

if [[ "$request_exists" == "t" ]]; then
  columns="$("${PSQL[@]}" -c "select count(*) from information_schema.columns where table_schema='public' and table_name='device_setup_requests' and column_name in ('request_secret_hash','verification_code','phone_e164','status')")"
  [[ "$columns" == "4" ]] || fail "device_setup_requests exists but does not match this release"
fi
if [[ "$codes_exists" == "t" ]]; then
  columns="$("${PSQL[@]}" -c "select count(*) from information_schema.columns where table_schema='public' and table_name='first_boot_sessions' and column_name in ('request_secret_hash','setup_code_id','hardware_id','status')")"
  [[ "$columns" == "4" ]] || fail "first_boot_sessions exists but does not match this release"
fi

"${PSQL[@]}" < "$migration_sql"
migration_state="$(IFS=,; printf '%s' "${migration_states[*]}")"

post_columns="$("${PSQL[@]}" -c "select count(*) from information_schema.columns where table_schema='public' and ((table_name='devices' and column_name in ('class_form','class_section')) or (table_name='first_boot_sessions' and column_name in ('class_form','class_section')))")"
[[ "$post_columns" == "4" ]] || fail "serial/class migration did not create all required columns"
unmapped="$("${PSQL[@]}" -c "select count(*) from public.devices where class_form between 1 and 6 and class_section ~ '^[A-Z]{1,4}$' and (btrim(coalesce(form_level,''))='' or btrim(coalesce(class_name,''))='')")"
[[ "$unmapped" == "0" ]] || fail "dashboard class backfill left $unmapped device(s) unmapped"
[[ "$("${PSQL[@]}" -c "select to_regprocedure('public.staff_issue_school_setup_code(uuid)') is not null")" == "t" ]] || fail "setup-code RPC is unavailable after migration"
[[ "$("${PSQL[@]}" -c "select count(*) from pg_policies where schemaname='public' and tablename='communication_receipts' and policyname='communication_receipts_school_support_reads'")" == "1" ]] || fail "support receipt policy is unavailable after migration"

install -d -m 755 "$functions_root/device-setup" "$functions_root/enroll"
install -m 644 "$BUNDLE_DIR/device-setup/index.ts" "$functions_root/device-setup/index.ts"
install -m 644 "$BUNDLE_DIR/enroll/index.ts" "$functions_root/enroll/index.ts"

docker restart "$EDGE_CONTAINER" >/dev/null
for _ in $(seq 1 30); do
  [[ "$(docker inspect -f '{{.State.Running}}' "$EDGE_CONTAINER")" == "true" ]] && break
  sleep 1
done
[[ "$(docker inspect -f '{{.State.Running}}' "$EDGE_CONTAINER")" == "true" ]] || fail "Edge Functions did not restart"

docker_root="$(dirname "$(dirname "$functions_root")")"
env_file="$docker_root/.env"
[[ -f "$env_file" ]] || fail "Supabase .env was not found at $env_file"
ANON_KEY="$(sed -n 's/^ANON_KEY=//p' "$env_file" | tail -n 1 | tr -d '\r' | sed 's/^"//;s/"$//')"
[[ -n "$ANON_KEY" ]] || fail "ANON_KEY is missing; it was not printed"

setup_code="$(curl -sS --retry 3 --retry-delay 2 -o "$health_body" -w '%{http_code}' -X POST "$API_URL/functions/v1/device-setup" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H 'content-type: application/json' \
  --data '{"action":"status","request_secret":"invalid"}')"
setup_response="$(cat "$health_body")"
[[ "$setup_code" == "401" ]] || fail "device-setup health check returned HTTP $setup_code"
grep -q 'invalid_request_secret' <<<"$setup_response" || fail "device-setup health check returned an unexpected response"
enroll_code="$(curl -sS --retry 3 --retry-delay 2 -o "$health_body" -w '%{http_code}' -X POST "$API_URL/functions/v1/enroll" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H 'content-type: application/json' \
  --data '{"token":"x"}')"
enroll_response="$(cat "$health_body")"
[[ "$enroll_code" == "400" ]] || fail "enroll health check returned HTTP $enroll_code"
grep -q 'invalid_token' <<<"$enroll_response" || fail "enroll health check returned an unexpected response"

cat > "$backup/deployment-receipt.txt" <<EOF
utc=$stamp
school_id=$EXPECTED_SCHOOL_ID
migration=$migration_state
edge_container=$EDGE_CONTAINER
device_setup_sha256=$(sha256sum "$BUNDLE_DIR/device-setup/index.ts" | awk '{print $1}')
enroll_sha256=$(sha256sum "$BUNDLE_DIR/enroll/index.ts" | awk '{print $1}')
EOF
chmod 600 "$backup/deployment-receipt.txt"
printf 'SUCCESS\nBackup: %s\nMigration: %s\nEdge Functions: healthy\n' "$backup" "$migration_state"
