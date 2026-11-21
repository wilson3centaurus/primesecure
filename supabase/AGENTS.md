# Mandatory shared-database safety gate

Before reading, writing, testing, applying, or documenting any SQL migration,
PostgREST configuration, database role, Realtime publication, Storage policy,
Edge Function deployment, or server command in this directory, read
`SHARED_DB_RULES.md` completely.

Do not run `supabase db push` against the RoboKorda production server. The
server is a shared self-hosted Supabase instance, does not currently have the
Supabase CLI migration ledger expected by this checkout, and contains several
unrelated projects. Apply only an explicitly reviewed, hash-pinned migration
through the guarded deployment procedure described in `SHARED_DB_RULES.md`.

If repository SQL conflicts with the shared-server rules, stop before any live
write. Document the conflict, inspect current server state read-only, and make
the migration schema-safe before deployment.
