# Connector operations

Connector is the only execution boundary between Core and installed harnesses.
It runs with access to host-side CLI programs, endpoints, credential stores, and
canonical room workspaces. Core never calls a harness directly.

This page is an operator reference. For a personal installation, first read
[Connector configuration](../user-guide/connector-configuration.md) and use
the control center rather than maintaining YAML by hand. UI-first installation
and authentication are covered by the [harness guides](../harnesses/README.md).
Protocol ownership and recovery invariants are described in the
[architecture overview](../architecture/overview.md).

## Public configuration

Create a YAML configuration and a shared Core/Connector token:

```bash
cp connector.example.yaml connector.yaml
export AGENVYL_CONNECTOR_CONFIG="$PWD/connector.yaml"
export AGENVYL_CONNECTOR_TOKEN="$(openssl rand -hex 32)"
```

`AGENVYL_CONNECTOR_TOKEN` must contain at least 32 characters. Use the same
value for Core and keep it out of YAML and source control.

The YAML contains only:

- the loopback listen address;
- allowed workspace roots;
- non-secret harness instance definitions;
- managed OpenCode state and explicit external-directory roots; and
- the explicit Claude subscription OAuth opt-in.

Unknown fields and invalid values are rejected. Tokens, passwords, executable
paths, provider credentials, and OAuth state remain in environment variables or
native harness stores.

Example:

```yaml
version: 1

listen:
  host: 127.0.0.1
  port: 4310

workspaces:
  roots:
    - /absolute/path/to/room-workspaces

instances:
  - id: local-codex
    type: codex
    enabled: true
  - id: local-opencode
    type: opencode
    enabled: true
    managed: true
    externalDirectoryRoots:
      - /absolute/path/to/trusted-repository
  - id: local-cursor
    type: cursor
    enabled: false
```

## Configuration schema

Connector uses a strict schema. Unknown keys are errors at every level, and a
configuration error prevents Connector from becoming ready. Sections shown as
optional below receive their defaults when omitted.

### Top-level fields

| Field | Required | Default | Meaning |
| --- | --- | --- | --- |
| `version` | Yes | None | Configuration format. Must be the integer `1`. |
| `listen` | No | `127.0.0.1:4310` | Connector HTTP listener. Keep it on loopback. |
| `workspaces` | No | Platform workspace directory | Allowed canonical room workspace roots. |
| `instances` | No | `[]` | Ordered harness instance definitions. |

`listen` accepts only `host` and `port`. `host` must be a non-empty string;
`port` must be an integer from `1` through `65535`.

`workspaces` accepts only `roots`, an array of unique absolute paths. An omitted
`workspaces` section or an empty `roots` array selects
`AGENVYL_WORKSPACE_ROOT`, then the platform data-directory default. A configured
root must already exist before an authenticated configuration update accepts
it.

### Instance fields

| Field | Required | Applies to | Default | Meaning |
| --- | --- | --- | --- | --- |
| `id` | Yes | All | None | Unique local ID matching `^[a-z0-9][a-z0-9_-]*$`. |
| `type` | Yes | All | None | `hermes`, `opencode`, `antigravity`, `codex`, `claude`, or `cursor`. |
| `enabled` | No | All | `true` | Whether Connector creates an adapter for the instance. |
| `endpoint` | No | Hermes, OpenCode | Harness environment value | Non-secret HTTP(S) server URL for this instance. |
| `managed` | No | OpenCode | `false` | Whether Connector owns the OpenCode server process. |
| `externalDirectoryRoots` | No | OpenCode | `[]` | Explicit allowlist for paths outside room workspaces. |
| `allowSubscriptionOAuth` | No | Claude | `false` | Records the explicit Claude subscription OAuth opt-in. |

An `endpoint` may not contain a username, password, query string, or fragment.
Credentials stay in the matching environment variables. Connector consumes
per-instance endpoints for Hermes and OpenCode; do not set `endpoint` for
process-based harnesses.

Every `externalDirectoryRoots` entry must be a concrete absolute path. Wildcard
segments, `..` traversal, control characters, mixed path separators, and
duplicates are rejected. The setting is invalid on non-OpenCode instances.
`managed` is also OpenCode-only, and `allowSubscriptionOAuth` is Claude-only.

The repository [configuration template](../../connector.example.yaml) shows
all supported harness types. It is a development and custom-deployment
starting point, not a file that portable users need to copy.

## File ownership and reload behavior

The portable supervisor creates `connector.yaml` only when it is missing; it
does not overwrite an existing file during start or repair. Authenticated
workspace and instance configuration APIs validate a complete candidate,
prepare its runtime adapters, and then atomically rewrite the file. On a
persistence or preparation failure, the active configuration remains in use.

Because persistence serializes the complete normalized document, comments and
custom formatting are not preserved. Connector loads a manually edited file at
process startup and does not watch it for changes. Stop the personal runtime
before a manual edit, or restart a separately managed Connector after editing.

In the supervised personal runtime, keep the YAML listener consistent with the
supervisor's `AGENVYL_CONNECTOR_PORT`. The supervisor uses that port for health
checks and for Core's Connector URL, while Connector binds the value stored in
the YAML.

Every workspace root must already exist and be absolute. For each run,
Connector resolves exactly one `<root>/<roomId>` and rejects traversal,
absolute request paths, symlink escape, missing directories, and ambiguous
roots.

`externalDirectoryRoots` is an OpenCode-only allowlist for upstream
external-directory permission requests. Each entry must be a concrete absolute
path without traversal or wildcard segments. An empty list denies external
access. Adding a directory through an Agenvyl approval persists the validated
root in the Connector instance configuration.

The personal first-run flow may replace the single workspace root through
authenticated `PUT /v2/workspaces`. The target directory must exist before
Connector accepts it; Core creates a selected setup directory first, then keeps
its workspace service and Connector policy on the same root.

Core also uses authenticated `POST /v2/directories/validate` to canonicalize
registered local-project folders and `POST /v2/directories/pick` to open the
host folder picker. These endpoints validate or select a directory only. They
do not add it to the workspace policy or an OpenCode external-directory
allowlist.

## Harness environment reference

| Harness | Environment variables |
| --- | --- |
| Hermes | `AGENVYL_CONNECTOR_HERMES_URL`, `AGENVYL_CONNECTOR_HERMES_TOKEN` |
| OpenCode | `AGENVYL_CONNECTOR_OPENCODE_COMMAND`, `AGENVYL_CONNECTOR_OPENCODE_URL`, `AGENVYL_CONNECTOR_OPENCODE_USERNAME`, `AGENVYL_CONNECTOR_OPENCODE_PASSWORD`, `AGENVYL_CONNECTOR_OPENCODE_CATALOG_DIRECTORY` |
| Codex | `AGENVYL_CONNECTOR_CODEX_COMMAND` |
| Claude | `AGENVYL_CONNECTOR_CLAUDE_COMMAND` |
| AGY | `AGENVYL_CONNECTOR_AGY_COMMAND`, `AGENVYL_CONNECTOR_AGY_PRINT_TIMEOUT_MS` |
| Cursor CLI | `AGENVYL_CONNECTOR_CURSOR_COMMAND` |

Hermes is attach-only. OpenCode with `managed: true` is started and stopped only
by Connector; `managed: false` is attach-only and leaves its lifecycle to the
operator. Codex owns one restartable app-server and multiplexes
ephemeral threads. Claude, AGY, and Cursor CLI start a fresh process for each
execution. Cursor runs headlessly and does not resume upstream sessions.

Do not put secrets into interpolated shell commands. Windows `.exe`, `.cmd`, and
`.bat` overrides are supported for Codex and Claude; AGY normally resolves its
official `.exe` through `PATH`.

## Run Connector

Development:

```bash
npm run dev:connector
```

Production build:

```bash
npm run build
npm run start:connector
```

Connector binds to `127.0.0.1:4310` by default. Check it with:

```bash
curl -fsS \
  -H "Authorization: Bearer $AGENVYL_CONNECTOR_TOKEN" \
  http://127.0.0.1:4310/v2/health
```

The personal runtime starts Connector through the bundled supervisor. A custom
deployment may use another service manager, but Connector must retain access to
the same host harnesses and canonical workspace tree.

## Discovery and instance lifecycle

`GET /v2/discovery` reports CLI and endpoint readiness without returning
credentials. `PUT /v2/instances` validates and atomically persists the selected
non-secret instance configuration. Requests are serialized, and an identical
ordered instance list is idempotent.

Each successful configuration change creates a new adapter generation. New
executions use the new generation while existing executions remain pinned to
the adapter and harness type with which they started. The old generation drains
until all of its executions reach a terminal state; there is no forced
retirement timeout. Connector-managed OpenCode processes are reference-counted
by instance and remain alive while any generation still uses them. Preparation
or persistence failure disposes only the candidate generation and leaves the
current configuration active.

Managed OpenCode ownership is recorded atomically under the Agenvyl state
directory. Connector verifies the PID, process start time, executable, and
launch arguments before stopping a stale process. A reachable endpoint without
matching ownership fails with `managed_endpoint_conflict`; Connector never
attaches to or terminates that process. Stop the external server, change the
instance to `managed: false`, or choose another loopback endpoint. The conflict
degrades only that instance; Connector and Harness Settings remain available so
the configuration can be corrected without editing files manually.

`POST /v2/instances/:id/restart` restarts only an enabled managed OpenCode
instance. It rejects active executions with `instance_busy`, starts and probes
the replacement server, loads its catalog, and activates a new adapter
generation. External instances cannot be restarted through Connector.

The per-instance catalog returns only models and controls the adapter can
represent safely. Unknown or incompatible upstream responses fail closed.
Vendor payloads are not part of the Core API.

## Execution lifecycle

The versioned v2 surface provides:

- idempotent execution start;
- execution inspection;
- ordered SSE events with monotonic cursors and bounded replay;
- stop;
- approval resolution; and
- clarification resolution.

Connector owns ephemeral processes, active execution state, and replay buffers.
Core owns durable product state. Connector assigns a process-lifetime epoch; a
restart changes the epoch, so Core never assumes that an older process remains
alive.

Every execution snapshot includes a positive `adapterGeneration`. The pair
`connectorEpoch` and `adapterGeneration` identifies the adapter configuration
that accepted the execution. Core stores the generation and the actual pinned
harness type with the run; historical runs created before this metadata was
introduced have no generation value.

Same-epoch Core restarts can inspect an execution and resume from the last
durable Connector cursor. Adapter diagnostics, tool summaries, and request text
pass through common redaction and size limits before persistence or transport.

AGY has no documented structured event or approval protocol, so its adapter
publishes final text and terminal state only. OpenCode supports multi-select
questions and validates external-directory permission requests against its
instance allowlist; malformed or unsupported payloads fail closed. Other
adapter-specific limits are documented in the
[harness overview](../harnesses/README.md).

Cursor CLI publishes assistant text and tool activity from `stream-json`.
Headless runs do not expose a documented reasoning, usage, approval, or
clarification round-trip, so Connector does not synthesize those events. Plan
runs use native Plan mode; Work runs require the explicit `accept-edits`
profile and Cursor's `--force` flag.

### Claude permission bridge lifecycle

Claude Code approvals use an internal MCP server owned by Connector. The
server starts lazily, binds to `127.0.0.1` on an operating-system-assigned
port, and is shared by all configured Claude instances until Connector stops.
It is not part of the public Connector API.

Each Claude execution receives a distinct random bearer token and a temporary
MCP configuration. Connector passes that file to the child process with
`--mcp-config` and selects the bridge tool with
`--permission-prompt-tool`. It never persists the server through
`claude mcp add` or edits user, project, or local Claude configuration.

Run tokens isolate concurrent executions, which can originate from different
rooms or parallel Plan responders in one room. Core keeps Work exclusive but
cannot guarantee that an instruction-only Plan harness remains read-only.
Permission requests are correlated with their execution and tool request before
they are published through the
normal Connector request events. Resolving, cancelling, or stopping an
execution completes only its own pending MCP calls. Tokens, MCP sessions, and
temporary files are removed at the end of the execution; a Connector restart
invalidates all remaining sessions.

The per-run server definition allows an MCP permission call to wait for a user
decision for up to 30 minutes. Agenvyl intentionally does not pass
`--strict-mcp-config`, so existing Claude MCP servers remain available, and it
does not pass `--bare`, so native credentials and normal Claude settings
continue to load.

## Core connection

Core requires both values:

```bash
export AGENVYL_CONNECTOR_URL=http://127.0.0.1:4310
export AGENVYL_CONNECTOR_TOKEN=<same-token>
```

Incomplete configuration makes Core fail at startup. There is no direct
harness fallback and no `AGENVYL_EXECUTION_BACKEND` selector.

## Verification

Fixture suites need no model credentials:

```bash
npm run test:e2e:hermes
npm run test:e2e:opencode
npm run test:codex
npm run test:e2e:codex
npm run test:claude
npm run test:e2e:claude
npm run test:cursor
npm run test:e2e:cursor
```

Live smoke tests are opt-in and require isolated workspaces, databases, and
credentials. Cursor's live check is `npm run smoke:cursor:live`. See
[Development testing](../development/testing.md).
