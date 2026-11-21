# PrimeSecure rules for the shared RoboKorda Supabase server

> **STOP: mandatory reading before database work.** The production VPS hosts
> multiple applications in one PostgreSQL instance, PostgREST process, Kong
> gateway, Realtime service and Storage service. A global role, schema, Docker
> volume or PostgREST change can take every application offline.

This repository-specific copy is based on the canonical rules at
`C:\Users\XO\Desktop\robocore\docs\SHARED_DB_RULES.md`. If the two documents
disagree about server-wide inventory, inspect production read-only and update
both documents before making a live change.

## Production identity

| Item | Current value |
| --- | --- |
| VPS | `178.238.227.229` |
| API | `https://api.robokorda.duckdns.org` |
| PostgreSQL container | `supabase-db` |
| PostgREST container | `supabase-rest` |
| Kong container | `supabase-kong` |
| Database | `postgres` |
| PrimeSecure school identity check | `14eea188-73b1-40bc-8f8d-15afbea27ffa` = `Rusununguko ZIMFEP High School` |

Never infer the target from a hostname, checkout or environment variable alone.
Verify the database container, database name and expected school row before a
write.

## Current PrimeSecure exception and migration direction

Read-only production audit on **21 November 2026** found:

- PrimeSecure predates the shared-schema convention.
- Its core application tables are already in `public`, including `schools`,
  `profiles`, `devices`, `commands`, `student_records` and `support_messages`.
- There is currently no `primesecure` schema.
- The server does not currently expose a
  `supabase_migrations.schema_migrations` ledger. A generic CLI `db push` cannot
  safely determine production history.
- `authenticator` already exposes many application schemas. The live value is
  broader than the older canonical list in the original rules document.
  Therefore never replace it with a copied static list.
- The student-chat tables and RPCs were not present during that audit.

This is a legacy exception, not permission to keep adding unrelated
PrimeSecure objects to `public`.

### Approved incremental direction

1. Leave the existing PrimeSecure `public` tables and functions unchanged
   during the chat release.
2. Put all new chat tables, policies, triggers and RPCs in the dedicated
   `primesecure` schema.
3. Cross-schema references to the legacy `public.devices`, `public.schools`,
   `public.student_records` and narrowly required helper functions are allowed
   only as a temporary compatibility bridge.
4. Dashboard and Android clients must explicitly select `primesecure` for chat
   REST/RPC calls. Existing non-chat calls continue to use `public`.
5. Add `primesecure` to `authenticator`'s `pgrst.db_schemas` with an additive
   read-modify-write block. Never replace the current list.
6. Relocating the legacy PrimeSecure core out of `public` is a separate project
   requiring an inventory, compatibility views or a coordinated client cutover,
   rollback testing and its own backup window.

Do not deploy a new chat migration in `public` with a promise to move it later.
That would increase the legacy surface and turn the later correction into a
live data migration.

## Golden rules

### 1. New application objects require an application schema

New PrimeSecure objects belong in `primesecure`, not `public`, `auth`,
`storage`, or another project's schema. Always schema-qualify tables,
functions, policies and trigger functions.

### 2. Never replace shared PostgREST configuration

Forbidden:

```sql
alter role authenticator set "pgrst.db_schemas" to 'public,primesecure';
alter role authenticator set search_path to 'primesecure,public';
```

The roles `authenticator`, `anon` and `authenticated` are shared. Read their
current configuration first. If `primesecure` is absent, append exactly that
schema while preserving every existing entry. Do not use a stale hard-coded
canonical list when a live value exists.

After a safe configuration change:

```sql
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
```

### 3. Scope grants and enable RLS

- Enable RLS on every exposed application table.
- Grant only the minimum privileges on `primesecure` objects.
- Never grant or revoke privileges across all objects in `public`, `auth`,
  `storage`, or another application schema.
- `SECURITY DEFINER` RPCs must set an empty `search_path`, schema-qualify every
  referenced object, validate `auth.uid()`/device identity, and have `PUBLIC`
  and `anon` execution revoked explicitly.

### 4. Do not modify other projects or shared infrastructure

- No DDL or data writes in `robocore`, `robokorda`, `aura`, `smartschools`,
  `smartshools_erp`, `azim_motors`, `rirc_competition`, or any other unrelated
  schema.
- Never run `docker compose down -v`.
- Do not restart PostgreSQL, Kong, Storage, Auth, Realtime or PostgREST merely
  to apply an application migration. Prefer transactional SQL and PostgREST
  notifications.
- Never alter shared role search paths or JWT settings during an application
  release.
- Do not change Storage files without preserving xattrs and making a verified
  backup.

### 5. Realtime is shared too

Adding a `primesecure` table to `supabase_realtime` is allowed only for a table
created by the same reviewed migration. Do not remove or replace publication
membership. Verify RLS before enabling publication.

### 6. Production migrations are explicit and guarded

Do not run `supabase db push` on this server. Instead:

1. Review the exact SQL and calculate its SHA-256.
2. Run the isolated migration/security tests locally.
3. Inspect the live target read-only and prove the migration is not already
   present or partially applied.
4. Back up the affected schema definitions and any affected rows with
   `pg_dump` from inside `supabase-db`.
5. Upload only the reviewed migration and checksum to a new mode-`0700`
   deployment directory.
6. Re-check the checksum on the server.
7. Apply with `psql -X -v ON_ERROR_STOP=1` inside a transaction and acquire a
   PrimeSecure-specific advisory lock.
8. Record a private deployment receipt containing timestamp, migration name,
   checksum, backup path and verification results. Do not print credentials or
   student data.
9. Verify database objects, grants, RLS and RPC execution.
10. Verify PostgREST still serves `public`, `primesecure`, and representative
    endpoints from the other active project schemas.

If any prerequisite or verification fails, stop. Do not retry a partially
understood production write.

## Chat-release acceptance checklist

The chat release is deployable only when all of these are true:

- [ ] No new chat table or chat RPC is created in `public`.
- [ ] The migration leaves all existing PrimeSecure `public` objects in place.
- [ ] `primesecure` is added to PostgREST additively.
- [ ] Android RPC requests send `Accept-Profile` and `Content-Profile` for
      `primesecure` chat calls.
- [ ] Dashboard chat queries explicitly use the `primesecure` schema.
- [ ] Realtime subscriptions explicitly name the `primesecure` schema.
- [ ] All chat tables have RLS and school/device isolation tests.
- [ ] Direct writes by student/device roles are denied; actions go through
      authenticated, validated RPCs.
- [ ] The migration passes against a clean database and a production-like copy.
- [ ] A production backup and rollback procedure has been reviewed.
- [ ] The staged dashboard is tested before production promotion.
- [ ] No APK or fleet update is activated merely because the database and web
      deployment succeeded.

## Read-only diagnostics

These checks are safe when their targets are exact and their output contains no
credentials or student data:

```bash
docker exec supabase-db psql -U supabase_admin -d postgres -c \
  "select rolconfig from pg_roles where rolname='authenticator';"

docker exec supabase-db psql -U supabase_admin -d postgres -c \
  "select nspname,nspowner::regrole from pg_namespace order by nspname;"

docker ps --format 'table {{.Names}}\t{{.Status}}'
```

Treat the database catalog as the source of truth. Docker environment values
may be overridden by role-level PostgREST settings.

## Decision record

On 21 November 2026 the schema-isolated internal student-chat migration was
applied to production by the operator. A subsequent read-only audit confirmed
the `primesecure` schema, six RLS-enabled chat tables, isolated RPCs, additive
PostgREST registration and Realtime publication membership. No chat table or
chat RPC was created in `public`.

The database migration succeeding does not by itself activate the feature on a
student device. Dashboard and Android schema selection, tested builds and a
controlled application release remain separate deployment steps.
