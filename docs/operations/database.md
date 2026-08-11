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

### Historical plan artifact migration

Migration 015 historically replaced the first persistent Plan/Work design with
version references to the room workspace's root `plan.md`. It cleared older
approval pointers while keeping agent answers. That one-message intent and
**Implement…** workflow is retained only in migration history and is removed by
migration 027 below.

### Persistent read-only room mode

Migration 027 replaces that artifact workflow with `rooms.workflow_mode`,
constrained to `plan | work` and defaulting to `work`. It removes approval and
implementation-plan foreign keys, columns, legacy approval events, and the old
execution-profile JSON key without deleting messages, run history, or workspace
files. An existing `plan.md` remains an ordinary versioned Markdown file.

Migration 033 changes the column default to `plan`. It does not update existing
room rows: only rooms inserted after the migration start in Plan. Existing
rooms keep their selected Plan or Work mode.

### Agent role removal

Migration 022 removes the standalone persona `role` column. Agent identity is
now defined by its name, handle, instructions, model, permissions, and harness
route. Existing role text is intentionally discarded rather than copied into
the system prompt, because silently converting a display field into executable
instructions would change agent behavior.

Back up PostgreSQL before upgrading a persistent installation if historical
role values must be retained outside Agenvyl.

### Transparent Git Workspace clean break

Migrations 029 through 032 introduce generated room-title provenance, immutable
preview bundles, direct Git checkpoints, and the final removal of the legacy
Workspace publication pipeline.

Migration 032 is intentionally destructive for legacy Workspace orchestration
metadata. It:

- deletes `run_workspace_results` created by legacy or warm-slot drivers;
- removes base, result, and published snapshot references;
- removes publication, conflict, cleanup, driver, and slot columns;
- drops room snapshot/materialization state; and
- drops snapshot, slot, and publication-conflict tables.

Room messages and live Workspace files are not deleted. Existing immutable file
objects can remain on disk, but legacy publication/conflict state and
snapshot-based app-build history are not migrated to `preview_bundles` and are
no longer addressable through the current application model.

This is an intentional clean break. Before upgrading from `v0.7.0`, keep a
verified pre-upgrade recovery point if the old build or conflict history must be
inspected later. Roll back the complete application and all matching durable
state to that backup; do not restore only the old database over new Workspace
repositories.

For local development data, reset PostgreSQL before testing these migration
breaks:

```bash
docker compose down -v
docker compose up -d postgres
```

This deletes the local Compose database volume. Back up any room or workspace
data that must be retained first. Portable installations should use their normal
uninstall/reset flow with the explicit purge option rather than deleting runtime
directories manually.

## Backup before upgrade

Wait for runs and Workspace mutations to finish. Create and verify a logical
backup before applying migrations in a persistent environment:

```bash
pg_dump --format=custom --no-owner --no-acl "$AGENVYL_DATABASE_URL" > agenvyl.dump
pg_restore --list agenvyl.dump >/dev/null
```

Stop Core after the dump, then copy the complete Workspace and Artifact roots.
Retain the database dump and both filesystem copies as one labeled recovery
point. Copy configuration and secrets when the rehearsal must reproduce
Connector and local-runtime settings.

Restore into a separate database and separate filesystem roots when rehearsing
an upgrade. Do not restore over a running application database or mix an old
database with newer room Git repositories.

## Restore rehearsal

Restore backups into a separate PostgreSQL database before relying on them:

```bash
createdb agenvyl_restore_check
pg_restore --exit-on-error --no-owner --no-acl \
  --dbname=agenvyl_restore_check agenvyl.dump
```

Start a disposable Core instance against the restored database and verify
readiness, room counts, timeline replay, Workspace references, Git repository
health, and historical app previews. Database, Workspace, and Artifact backups
form one recovery point and must be retained together.
