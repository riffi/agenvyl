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

`AGENVYL_RUN_TIMEOUT_MS` sets a vendor-neutral execution deadline, starting after the
upstream run is accepted (default `900000`, or 15 minutes). The deadline is persisted,
survives a Core restart, and does not include time spent in the local queue. When it
expires, Core durably fails the run with `run_timeout`, aborts its local event stream,
and sends one best-effort stop command through the configured gateway. A late upstream
completion or cancellation cannot replace the timeout terminal state.

Cancelling a queued run removes it before any execution request and persists a
`cancelled` terminal event. Queue depth and active count are available through the
executor's internal `stats()` API for future metrics integration.

## Restart recovery

At startup the backend reconciles persisted runs in `queued`, `streaming`,
`stopping`, `waiting_approval` or `waiting_clarification`. Legacy direct-Hermes runs
become `failed` and receive a durable room event. Core cannot stop those historical
upstream runs because the direct transport has been removed.

Connector-bound runs use the internal health/inspect client when
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

Each room gets a live filesystem directory below `AGENVYL_WORKSPACE_ROOT`. Arbitrary
files up to `AGENVYL_WORKSPACE_MAX_FILE_BYTES` (50 MiB by default) can be uploaded;
the same limit applies to versions captured from agent writes. Larger agent files
remain visible on disk as `oversize`, but cannot be attached or versioned. The
path exposed to harness runs can be configured separately with
`AGENVYL_WORKSPACE_AGENT_ROOT`; use it whenever Core and the harness observe the
same workspace through different absolute paths.

Immutable content-addressed versions are stored below the hidden `.versions/`
directory at the workspace root. Message attachments point to a version rather
than mutable live content. A recursive watcher plus reconciliation on list/run
completion captures direct agent writes; concurrent writers are attributed as a
shared change. Do not edit `.versions/` manually. Room deletion is recoverable;
permanent deletion removes room data, its live tree and blobs no longer referenced
by another room.

The production-like image runs as the unprivileged `node` user (UID 1000). Before
the app starts, the one-shot `workspace-init` Compose service fixes ownership of
the bind-mounted workspace tree to UID/GID 1000. This is required because Docker
may create a missing host bind directory as `root:root`, which otherwise makes
lazy room-directory creation fail with `EACCES`.

Room workspaces are shared-file locations, not sandboxes, and do not restrict which
other VPS paths or repositories an agent may use when the task calls for it.
