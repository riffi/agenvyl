# Backend runtime policy

## Health endpoints

- `GET /health` is a process liveness probe. It does not call dependencies and
  returns `200 ok` while Fastify can serve requests.
- `GET /api/v1/health` is readiness. It checks PostgreSQL and Connector, the
  only configured `run_gateway`.
  It returns `200` with `status=ready` only when both dependencies are available;
  otherwise it returns `503` with per-dependency state. The public payload does not
  expose the adapter vendor name.

## Run queue

Runs are scheduled in process through a FIFO queue. `AGENVYL_RUN_CONCURRENCY` controls the
maximum number of simultaneous execution streams and defaults to `4`. The queue is not
distributed and intentionally assumes one backend process.

`AGENVYL_RUN_TIMEOUT_MS` sets a vendor-neutral inactivity deadline, starting after the
upstream run is accepted (default `900000`, or 15 minutes). Every accepted Connector
transition refreshes the deadline, so an agent that continues to report reasoning,
tool progress, requests, or output is not interrupted merely because the overall task
is long. The deadline is persisted, survives a Core restart, and does not include time
spent in the local queue. When it expires, Core durably fails the run with
`run_timeout`, aborts its local event stream, and sends one stop command through the
configured gateway. A late upstream completion or cancellation cannot replace the
timeout terminal state.

`AGENVYL_FEATURE_PLAN_MODE` controls the experimental Plan Mode workflow. It
accepts only `true` or `false` (case-insensitive), defaults to `false`, and is
read when Core starts. Changing it requires a Core restart, not a frontend
rebuild.

Cancelling a queued run removes it before any execution request and persists a
`cancelled` terminal event. Queue depth and active count are available through the
executor's internal `stats()` API for future metrics integration.

## Restart recovery

At startup the backend reconciles persisted runs in `queued`, `streaming`,
`stopping`, `waiting_approval` or `waiting_clarification`. Runs use the internal
Connector health/inspect client when
`AGENVYL_CONNECTOR_URL` and `AGENVYL_CONNECTOR_TOKEN` are both set. A changed
`connectorEpoch` becomes the vendor-neutral `connector_restarted` failure. A missing
execution or unavailable Connector also fails closed with a vendor-neutral code.
These terminal outcomes remain retryable. A same-epoch execution is reattached to the
active registry and its SSE stream resumes from the durable Connector cursor. Cursor
and projected Core room events are committed in one transaction, so replayed deltas,
tools and requests are neither duplicated nor skipped. A terminal snapshot catches up
the Core terminal status when the terminal event cursor was already durable. If the
cursor has fallen outside the bounded replay window, the run fails with
`connector_replay_unavailable` and remains retryable.

## Execution routing

Core requires `AGENVYL_CONNECTOR_URL` and `AGENVYL_CONNECTOR_TOKEN`; incomplete
configuration fails at startup, and the removed `AGENVYL_EXECUTION_BACKEND` selector is
rejected. The bridge sends only canonical room-relative workspace identity over HTTP,
maps Connector events into existing Core room events and stores execution ID, epoch and
the last accepted cursor on the run. There is no direct harness fallback.

Recovered pending approvals are restored into the active run context, so approval and
cancel controls continue through the Connector after a Core restart. Connector runs
aborted by graceful Core shutdown remain non-terminal for this recovery path.

## Shutdown

On Fastify close the executor:

1. stops accepting new runs;
2. marks queued runs failed;
3. aborts active streams;
4. waits up to `AGENVYL_SHUTDOWN_TIMEOUT_MS` (default `10000`);
5. logs a warning if tasks do not settle before the timeout.

The process supervisor remains responsible for its final termination grace period.

## WebSocket slow consumers

Before each room event send, the adapter checks `bufferedAmount`. When it exceeds
`AGENVYL_WEBSOCKET_MAX_BUFFERED_BYTES` (default `1048576`), the socket is closed with code
`1013` and reason `Slow consumer`. The client reconnects with its last applied room
sequence and receives durable replay.

## Logging

Run lifecycle logs contain structured `correlationId`, `roomId`, local `runId`,
upstream run ID and transition fields. Prompt, message and response content are not
logged. Harness credentials never enter Core; Connector applies header redaction.

## Room workspaces

Each room has one canonical published workspace snapshot and one live
filesystem materialization below `AGENVYL_WORKSPACE_ROOT`. Uploads and external
edits refresh the published snapshot after reconciliation. The path exposed to
harness runs can be configured separately with `AGENVYL_WORKSPACE_AGENT_ROOT`;
use it whenever Core and the harness observe the same workspace through
different absolute paths.

Before a run starts, Core:

1. records the room's current published snapshot as the run's base;
2. acquires an eligible warm slot or creates a managed worktree below
   `.agenvyl/runs/<run-id>/workspace`;
3. materializes the base snapshot into that worktree; and
4. passes the corresponding agent-visible path to Connector.

Parallel runs therefore receive independent worktrees and do not normally
observe one another's unfinished writes. This is a consistency mechanism, not
a security boundary: a harness with sufficient operating-system permissions
may still access paths outside its assigned worktree.

When a run finalizes, Core scans its worktree and stores a result snapshot. A
complete result is compared with the base and latest published snapshots:

- paths changed only by the run are applied automatically;
- paths changed identically in both states need no resolution;
- paths changed independently become `workspace_publish_conflicts`;
- the non-conflicting result is still published, producing
  `partially_published`; and
- an incomplete capture remains `not_published`.

Conflict resolution is optimistic. The request includes the published snapshot
the user reviewed. If the room changes before resolution is committed, Core
recalculates the outstanding conflicts and rejects the stale decision. A
successful resolution creates another immutable published snapshot.

After publication, Core materializes the published snapshot into the live room
tree and cleans up the run worktree. Startup recovery retries pending
materializations and cleanup of captured orphan worktrees. The top-level
`.agenvyl` path is reserved; a pre-existing unmanaged path causes run
preparation to fail closed instead of overwriting user data.

### Workspace lifecycle optimization modes

Three independent startup settings control the optimized lifecycle:

- `AGENVYL_WORKSPACE_NOOP_MODE`
- `AGENVYL_WORKSPACE_WARM_SLOTS_MODE`
- `AGENVYL_WORKSPACE_STAT_CACHE_MODE`

Each accepts only `off`, `shadow`, or `on` and defaults to `off`. Invalid values
fail startup. Stat cache `shadow` or `on` requires warm slots to be `on`.
Changing any mode requires a Core restart. Database migrations and already
created snapshots or slots remain compatible when a mode is switched back to
`off`.

No-op mode compares a complete captured manifest with the immutable base
snapshot. In `shadow`, Core records the prediction but retains the legacy
save/publish flow. In `on`, an exact match completes with
`publish_status=noop`, points `result_snapshot_id` at the base snapshot, and
does not create snapshot, entry, artifact, conflict, publication, or live
materialization work. This is a neutral UI state rather than a publication
success notice. Any capture error disables the fast path.

Warm slots keep at most two workspaces per room/persona under
`.agenvyl/agents/<persona-id>/slots/<0|1>/workspace`. Ownership and generation
fences are durable in PostgreSQL. If both slots are unavailable, the run uses
the legacy per-run worktree. `shadow` prepares and validates a slot while the
legacy worktree remains authoritative; `on` passes the slot path to Connector.
Incomplete or unsafe captures quarantine the affected slot, while legacy
fallback keeps runs available. A slot lease follows the execution deadline
plus a five-minute grace period, but an expired lease never overrides a
non-terminal run owner.

Stat cache always traverses the directory tree, so creates, deletes, and
renames remain visible. On a filesystem that passes the identity, ctime, and
timestamp capability probe, `on` can reuse a file version only when all saved
stat fingerprint fields match and the entry is outside the racy fence window.
`shadow` predicts reuse but hashes every file. Every hundredth slot generation
also performs a full verification. A mismatch invalidates the slot cache and
the current capture uses the actual SHA-256.

Cleanup is recorded separately from the terminal capture/publish result.
Deletion failures use durable retry metadata and stop frequent retries after
24 hours by entering `quarantined`; they do not rewrite a successfully saved
workspace result. Startup recovery runs in this order: pending live
materializations, Connector/non-terminal run reconciliation, then abandoned
capture finalization and pending cleanup. A workspace belonging to a
non-terminal run is never removed solely because its lease or process state is
stale.

Workspace lifecycle structured logs include prepare, capture, publish and
materialization durations; copied, scanned and hashed files/bytes; changed
paths; snapshot row/entry counts; no-op and legacy fallback decisions; stat
cache hits; cleanup; and quarantine outcomes. Promotion from `shadow` to `on`
should require zero manifest/content mismatches across representative runs and
no p95 bootstrap regression above five percent before changing packaged
defaults.

Arbitrary files up to `AGENVYL_WORKSPACE_MAX_FILE_BYTES` (50 MiB by default)
can be uploaded; the same limit applies to versions captured from run or
external writes. Larger live files remain visible as `oversize`, but cannot be
attached or versioned. An oversize or unreadable run result makes capture
incomplete and prevents its publication.

Immutable content-addressed versions are stored below the hidden `.versions/`
directory at the workspace root. Workspace history is associated with a stable
entry identity, so rename and move operations retain earlier versions. Message
attachments and run artifacts point to exact versions and, when applicable,
their origin snapshots rather than mutable live content. Do not edit
`.versions/` or `.agenvyl/` manually.

Room deletion is recoverable. Permanent deletion removes room records, the
live tree, managed run worktrees, and blobs no longer referenced by another
room.

Room workspaces are shared-file locations, not sandboxes, and do not restrict which
other VPS paths or repositories an agent may use when the task calls for it.
