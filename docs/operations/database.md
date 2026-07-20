# PostgreSQL operations

## Migrations

Backend applies forward-only SQL migrations during startup. Applied versions are
recorded in `schema_migrations`; startup is safe to repeat against an already
migrated database. A failed migration is rolled back together with its version
record, and the backend must not accept traffic until migrations succeed.

Never edit a migration that has reached a shared environment. Correct mistakes
with a new forward-fix migration. Rollback SQL is optional because destructive
rollback can lose data and cannot reliably reverse application traffic.

## Backup before upgrade

Create and verify a logical backup before applying migrations in a persistent
environment:

```bash
pg_dump --format=custom --no-owner --no-acl "$AGENVYL_DATABASE_URL" > agenvyl.dump
pg_restore --list agenvyl.dump >/dev/null
```

Restore into a separate database first when rehearsing an upgrade. Do not restore
over a running application database.

## SQLite import policy

The PostgreSQL migration starts with a new schema and seed. Existing SQLite data
is not imported automatically during backend startup. Automatic dual-database
startup would make deployment non-idempotent and hide partial imports.

If historical SQLite data must be retained, use a separately reviewed one-shot
importer while the backend is stopped. The importer must preserve IDs, immutable
persona versions, run snapshots, JSON payloads and per-room event ordering; validate
row counts and foreign keys before switching traffic. Legacy Hermes session mappings
are intentionally discarded because each attempt now creates an isolated upstream
session from its durable run snapshot.
The old SQLite volume/file must remain read-only until that validation succeeds.

For the current dev stand the old `group-chat-data` volume is intentionally not
deleted by the PostgreSQL deployment.
