# PostgreSQL operations

## Migrations

Backend applies forward-only SQL migrations during startup. Applied versions are
recorded in `schema_migrations`; startup is safe to repeat against an already
migrated database. A failed migration is rolled back together with its version
record, and the backend must not accept traffic until migrations succeed.

Never edit a migration that has reached a shared environment. Correct mistakes
with a new forward-fix migration. Rollback SQL is optional because destructive
rollback can lose data and cannot reliably reverse application traffic.

### Execution-profile clean break

Migration 014 removes persona/run `mode_id` values and introduces room-scoped
Plan/Work, reasoning effort, and approved-plan snapshots. Legacy mode values are
intentionally not translated: rooms start in `Work` with `Auto` effort, while
persona permissions and provider agent variants must be selected again.

### Plan artifact clean break

Migration 015 replaces the persistent room Plan/Work mode and run-based plan
approval with version references to the room workspace's root `plan.md`.
Existing approval pointers are intentionally cleared; historical agent answers
remain in the timeline. Plan creation is a one-message execution intent, while
normal messages always run as Work. An explicit **Implement…** request snapshots
the approved workspace version on every created run.

For local development data, reset PostgreSQL before testing this protocol break:

```bash
docker compose down -v
docker compose up -d postgres
```

This deletes the local Compose database volume. Back up any room or workspace
data that must be retained first. Portable installations should use their normal
uninstall/reset flow with the explicit purge option rather than deleting runtime
directories manually.

## Backup before upgrade

Create and verify a logical backup before applying migrations in a persistent
environment:

```bash
pg_dump --format=custom --no-owner --no-acl "$AGENVYL_DATABASE_URL" > agenvyl.dump
pg_restore --list agenvyl.dump >/dev/null
```

Restore into a separate database first when rehearsing an upgrade. Do not restore
over a running application database.

## Restore rehearsal

Restore backups into a separate PostgreSQL database before relying on them:

```bash
createdb agenvyl_restore_check
pg_restore --exit-on-error --no-owner --no-acl \
  --dbname=agenvyl_restore_check agenvyl.dump
```

Start a disposable Core instance against the restored database and verify
readiness, room counts, timeline replay, and workspace references. Database and
workspace backups form one recovery point and should be retained together.
