# Backend runtime policy

## Health endpoints

- `GET /health` is process liveness and does not call dependencies.
- `GET /api/v1/health` checks PostgreSQL and Connector readiness. It returns
  `200` only when both are available and otherwise returns `503` with
  per-dependency state. The public payload does not expose a vendor name.

## Run queue and workflow-aware room concurrency

Runs use an in-process queue. `AGENVYL_RUN_CONCURRENCY` controls the maximum
number of simultaneous execution streams and defaults to `4`. The queue is not
distributed and assumes one Core process.

The global limit is combined with workflow-aware room rules:

- Plan runs may execute concurrently in the same room;
- Work requires no active run in that room and no earlier same-room pending run;
- an earlier or active Work run blocks Plan, so later Plan runs cannot overtake
  an implementation step;
- consecutive Plan runs before a Work barrier may fill available global slots;
- runs from different rooms may occupy the remaining slots; and
- no scheduler rule serializes an external project shared by concurrent runs.

Core serializes Workspace prepare and finalization per room even for parallel
Plan runs, so its own Git index operations do not overlap. The agent execution
between those lifecycle sections remains concurrent.

Immediately before a normal queued run starts, Core refreshes its persisted
conversation history through the current human-message boundary. Responders to
the same message therefore retain identical pre-round conversation context,
Plan responders can start from the same pre-round conversation concurrently.
Later Work responders observe filesystem changes left in the shared Workspace.
Retries keep their original saved conversation context and workflow mode.

`AGENVYL_RUN_TIMEOUT_MS` sets the inactivity deadline after Connector accepts a
run, default `900000`. Connector transitions refresh it; queue time is excluded.
Expiry durably fails the run with `run_timeout`, aborts the local stream, and
sends one stop command. A late terminal event cannot replace that state.

Cancelling a queued run removes it before execution and persists `cancelled`.
Internal executor stats expose queue depth and active count for future metrics.

## Workflow mode

Plan is always available and is the database default for newly inserted rooms.
Migration 033 changes only that column default, so existing rows retain their
current mode. Sticky `rooms.workflow_mode` is copied into every run created for
a message while the room row is locked. A later toggle does not alter existing
runs, and retry copies the original run's execution profile.

Native Plan chooses the strongest read-only behavior exposed by the harness.
Instruction-only Plan cannot prevent a process with operating-system access
from writing to the Workspace or an external project. Because Plan runs can be
parallel, those writes can race. Operators should use only native read-only Plan
when shared paths cannot tolerate concurrent changes.

Every MCP operation in Plan, including a read-only call, requires explicit
human confirmation through structured clarification. The agent requests one
bounded batch by naming the integration, target, planned operations, and known
side effects. Confirmation applies only to that batch and run, does not switch the
workflow mode, and may cover multiple calls needed to complete the batch. A
materially different operation or target requires another confirmation. If the
harness cannot pause for structured clarification, the agent must not perform
the MCP operation.

## Restart recovery

At startup Core reconciles persisted runs in `queued`, `streaming`, `stopping`,
`waiting_approval`, or `waiting_clarification` through Connector inspect/replay.
A changed Connector epoch becomes `connector_restarted`. Missing execution,
unavailable Connector, or an expired replay window also fails closed with a
vendor-neutral retryable code.

For a same-epoch execution, Core restores the active registry and resumes SSE
from the durable cursor. Cursor advancement and projected room events commit in
one transaction so replay neither duplicates nor skips accepted events.

After run reconciliation, `RoomWorkspaceService.recoverRuns` finds terminal
runs whose capture is still `ready` or `finalizing` and retries direct Git
finalization. There are no live materialization or worktree-cleanup recovery
queues.

## Execution routing

Core requires both `AGENVYL_CONNECTOR_URL` and
`AGENVYL_CONNECTOR_TOKEN`. Incomplete configuration fails startup. Connector
receives canonical room-relative Workspace identity and owns all harness
protocol adaptation. There is no direct harness fallback.

Recovered pending approvals return to the active run context. Graceful Core
shutdown can leave an upstream Connector run non-terminal for same-epoch
reattach.

## Add instruction to a run

An active Codex or OpenCode run may accept one instruction at a time. Connector
interrupts the current native turn and starts a replacement turn in the same
session with the original model, workflow, permissions, and agent settings. It
does not create a room message, conversation round, Workspace, or scheduler
entry.

Accepted, applied, and failed intervention events use the normal durable
Connector cursor. Core stores the current answer segment as `precedingText`
with local author and timestamp, then starts an empty active segment. Later
status events update that intervention in place. Historical `supersededText`
values are read as `precedingText`.

Reasoning, tools, usage, timeout, Workspace writes, and external side effects
remain aggregated in the same run. Add instruction is not rollback. Stop takes
priority and prevents a replacement turn from starting.

For a selected completed Codex or OpenCode response, Add instruction creates a
linked run without replaying canonical history. Connector resumes the retained
native session, and Core invalidates and explicitly releases the session when
the continuation chain is no longer selectable.

## Shutdown

On Fastify close the executor:

1. stops accepting new runs;
2. marks queued runs failed;
3. aborts active streams;
4. waits up to `AGENVYL_SHUTDOWN_TIMEOUT_MS`, default `10000`; and
5. logs when tasks do not settle before the deadline.

The process supervisor owns the final termination grace period.

## WebSocket slow consumers

Before sending a room event, the adapter checks `bufferedAmount`. Above
`AGENVYL_WEBSOCKET_MAX_BUFFERED_BYTES`, default `1048576`, it closes with code
`1013` and reason `Slow consumer`. The client reconnects from its last applied
room sequence and receives durable replay.

## Logging

Run logs contain structured correlation, room, run, upstream execution, and
transition fields. Prompt, message, and response text are not logged. Connector
applies credential header redaction.

Workspace logs use `workspace.prepare`, `workspace.capture`, and
`workspace.preview_capture` metrics with room/run IDs, Git heads, capture
status, duration, changed-path count, and errors. The removed snapshot,
publication, materialization, slot, and cleanup metrics no longer apply.

## Room workspaces

Each room has one live filesystem tree below `AGENVYL_WORKSPACE_ROOT`. The tree
is a visible Git repository and is the working directory passed to Connector.
When Core and a harness see the same storage through different absolute paths,
`AGENVYL_WORKSPACE_AGENT_ROOT` supplies the agent-visible root.

### Repository initialization

On first access, Core creates the room directory, initializes a `main` branch,
creates or extends `.gitignore`, and writes an initial commit as
`Agenvyl <agenvyl@localhost>`. The initial ignore set covers `.agenvyl/`,
dependencies, common build output, caches, coverage, and secret `.env*` files
while allowing `.env.example`.

The `.git` marker must be a directory. A Git worktree-style `.git` file is
rejected because Agenvyl requires a visible self-contained repository.

Before prepare and finalization, Core checks for merge, rebase, cherry-pick,
revert, and bisect markers. Any unfinished operation fails closed.

### Prepare and finalization

Before a run starts, Core:

1. ensures the repository is healthy;
2. commits dirty live files as `agenvyl: checkpoint before run <run-id>`;
3. stores the resulting HEAD as `run_workspace_results.base_head`; and
4. passes the same room directory to Connector.

When a completed, failed, or cancelled run finalizes, Core:

1. commits remaining dirty files as
   `agenvyl: checkpoint <status> run <run-id>`;
2. calculates changed paths with Git diff from `base_head` to `result_head`;
3. stores exact content-addressed versions for changed files and deletion
   references where applicable;
4. classifies response artifacts as `project` or `hidden`;
5. captures a static preview bundle when supported output exists; and
6. persists `result_head`, optional `checkpoint_sha`, capture status, and
   errors.

Capture status is `complete` when no file errors occurred and `incomplete`
otherwise. An exception during finalization records `failed`. Preview-bundle
failure is logged and stored on its own row but does not replace the Workspace
result.

There is no save/publish merge after a run. The run already changed the live
folder, so there are no `publish_status`, conflict records, materialization
steps, run worktrees, or warm slots.

### Direct Workspace mutations

Uploads, directory creation, move, delete, entry restore, and version restore
are serialized per room and rejected with HTTP `409 workspace_writer_active`
while an active run is writing. Successful mutations create a Git checkpoint
and emit `workspace.changed`.

`.git`, `.versions`, and `.agenvyl` path segments are reserved from public
mutations.

### File versions and limits

`AGENVYL_WORKSPACE_MAX_FILE_BYTES`, 50 MiB by default, limits uploads and
captured immutable versions. Larger live files remain visible as `oversize` but
cannot be attached or versioned. Unreadable or unstable changed files make the
run capture incomplete.

Content-addressed version objects live below the Workspace root's hidden
`.versions/` store. Stable entry identity preserves history across UI rename and
move operations. Attachments and response artifacts reference exact immutable
versions; a current live version ID resolves the bytes presently at the path.

`RunArtifactPolicy` hides generated, dependency, cache, test, VCS,
secret-environment, and root `.gitignore` matches from normal response lists.
Generated output is still eligible for a preview bundle.

Room deletion removes its live repository, database-owned version references,
unreferenced version objects, and associated preview bundles.

## Preview artifact store

`AGENVYL_ARTIFACT_ROOT` selects the filesystem root for immutable preview
bundles. The portable runtime defaults it to the platform data `artifacts/`
directory. Custom deployments must persist it independently from the Workspace
root.

`AGENVYL_ARTIFACT_MAX_BYTES` defaults to `262144000` and limits both compressed
and uncompressed bundle size. `PreviewBundleStore` publishes a ZIP and metadata
atomically and rejects different content for an existing immutable preview ID.

Only `ready` bundles enter build history. Current selection compares each
bundle's `source_head` to the current room Git HEAD.

PostgreSQL, Workspace root, and Artifact root form one recovery point. See
[database operations](database.md) and
[data and backups](../user-guide/data-and-backups.md).
