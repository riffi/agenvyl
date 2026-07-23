# Connector operations

Connector is the only execution boundary between Core and installed harnesses.
It runs with access to host-side CLI programs, endpoints, credential stores, and
canonical room workspaces. Core never calls a harness directly.

This page is an operator reference. For UI-first installation and
authentication, use the [harness guides](../harnesses/README.md). Protocol
ownership and recovery invariants are described in the
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
- managed OpenCode state; and
- explicit AGY, Codex full-access, and Claude OAuth opt-ins.

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
    allowDangerFullAccess: false
  - id: local-opencode
    type: opencode
    enabled: true
    managed: true
```

Every workspace root must already exist and be absolute. For each run,
Connector resolves exactly one `<root>/<roomId>` and rejects traversal,
absolute request paths, symlink escape, missing directories, and ambiguous
roots.

## Harness environment reference

| Harness | Environment variables |
| --- | --- |
| Hermes | `AGENVYL_CONNECTOR_HERMES_URL`, `AGENVYL_CONNECTOR_HERMES_TOKEN` |
| OpenCode | `AGENVYL_CONNECTOR_OPENCODE_COMMAND`, `AGENVYL_CONNECTOR_OPENCODE_URL`, `AGENVYL_CONNECTOR_OPENCODE_USERNAME`, `AGENVYL_CONNECTOR_OPENCODE_PASSWORD`, `AGENVYL_CONNECTOR_OPENCODE_CATALOG_DIRECTORY` |
| Codex | `AGENVYL_CONNECTOR_CODEX_COMMAND` |
| Claude | `AGENVYL_CONNECTOR_CLAUDE_COMMAND` |
| AGY | `AGENVYL_CONNECTOR_AGY_COMMAND`, `AGENVYL_CONNECTOR_AGY_PRINT_TIMEOUT_MS` |

Hermes is attach-only. OpenCode may attach to an existing endpoint or run as a
Connector-managed child. Codex owns one restartable app-server and multiplexes
ephemeral threads. Claude and AGY start a fresh process for each execution.

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
non-secret instance configuration, then applies managed adapter lifecycle
changes.

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

Same-epoch Core restarts can inspect an execution and resume from the last
durable Connector cursor. Adapter diagnostics, tool summaries, and request text
pass through common redaction and size limits before persistence or transport.

AGY has no documented structured event or approval protocol, so its adapter
publishes final text and terminal state only. OpenCode multi-select questions
and external-directory permission requests fail closed. Other adapter-specific
limits are documented in the [harness overview](../harnesses/README.md).

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

Run tokens isolate parallel executions. Permission requests are correlated
with their execution and tool request before they are published through the
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
```

Live smoke tests are opt-in and require isolated workspaces, databases, and
credentials. See [Development testing](../development/testing.md).
