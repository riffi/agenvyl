# Host-side Agenvyl Connector

Connector runs on the host beside installed coding-agent harnesses and their
credential stores. Core is also host-side in the portable runtime. Core reaches every
harness through Connector; there is no direct or fallback execution path.

For protocol ownership and lifecycle invariants, see the
[architecture overview](../architecture/overview.md).

## Configure

Create the public YAML configuration and a shared Core/Connector token:

```bash
cp connector.example.yaml connector.yaml
export AGENVYL_CONNECTOR_CONFIG="$PWD/connector.yaml"
export AGENVYL_CONNECTOR_TOKEN="$(openssl rand -hex 32)"
```

`connector.yaml` contains only the listen address, allowed workspace roots, and
enabled instance definitions. Tokens, harness URLs, executable paths, passwords,
and OAuth state must remain in the process environment or native harness stores.
Unknown YAML fields are rejected.

Every workspace root must be an existing absolute directory. For a room run,
Connector resolves exactly one `<root>/<roomId>` and rejects traversal, absolute
request paths, symlink escape, missing directories, and ambiguous roots.

## Run

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
  http://127.0.0.1:4310/v1/health
```

The repository does not prescribe a supervisor. A deployment may use systemd,
launchd, a container sidecar, or a manual process, provided that Connector keeps
access to the host harness runtimes and canonical room workspaces.

## Hermes

Enable the `local-hermes` instance and point Connector at an already running
Hermes HTTP service:

```bash
export AGENVYL_CONNECTOR_HERMES_URL="http://127.0.0.1:8642"
export AGENVYL_CONNECTOR_HERMES_TOKEN="<optional-hermes-token>"
```

Hermes provides model discovery, streaming text, tool activity, approvals,
usage counters, and cancellation. The token is optional only when the local
Hermes service itself does not require one.

## OpenCode

Run OpenCode separately, enable `local-opencode`, and configure its endpoint:

```bash
opencode serve --hostname 127.0.0.1 --port 4096
export AGENVYL_CONNECTOR_OPENCODE_URL="http://127.0.0.1:4096"
```

If the server uses authentication:

```bash
export AGENVYL_CONNECTOR_OPENCODE_USERNAME="opencode"
export AGENVYL_CONNECTOR_OPENCODE_PASSWORD="<opencode-password>"
```

`AGENVYL_CONNECTOR_OPENCODE_CATALOG_DIRECTORY` optionally selects project
context for catalog discovery. Executions always use the canonical room
workspace selected by Connector.

OpenCode supports catalog and modes, text and reasoning events, tool activity,
manual approvals, one-question clarifications, usage counters, and cancellation.
External-directory permission requests are rejected at the adapter boundary.
Batch and multi-select questions fail closed because Agenvyl cannot represent
them safely.

## Antigravity / AGY

Install and authenticate `agy >= 1.1.3`, trust the configured workspace root,
and enable `local-antigravity`. The adapter is disabled unless the dangerous
mode is explicitly accepted:

```bash
agy
export AGENVYL_CONNECTOR_AGY_COMMAND="$HOME/.local/bin/agy"
export AGENVYL_CONNECTOR_AGY_DANGEROUSLY_SKIP_PERMISSIONS=true
export AGENVYL_CONNECTOR_AGY_PRINT_TIMEOUT_MS=1800000
```

The timeout should be longer than Core's `AGENVYL_RUN_TIMEOUT_MS`, so Core owns
the product deadline. Connector disables AGY auto-update for child processes.

Each attempt starts a fresh `agy --print` process in the room workspace with an
exact model and either `plan` or `accept-edits` mode. The explicit opt-in passes
`--dangerously-skip-permissions`; Agenvyl cannot provide an approval round-trip
for AGY. Prefer `plan` for read-only work.

The CLI does not expose a documented structured event protocol. The adapter
therefore publishes final text and terminal state only, does not fabricate
tools or usage, bounds prompt/stdout/stderr sizes, and cancels the POSIX process
group with TERM followed by KILL.

## Core settings

Core requires the same token and a Connector URL:

```bash
export AGENVYL_CONNECTOR_URL="http://127.0.0.1:4310"
export AGENVYL_CONNECTOR_TOKEN="<same-token>"
```

The portable runtime uses the loopback URL shown above. Missing or incomplete
Connector settings make Core fail at startup.

## Verification

Deterministic fixture-based gates do not require model credentials:

```bash
npm run test:e2e:hermes
npm run test:e2e:opencode
```

Live smoke tests are opt-in and require separately running harnesses, isolated
workspaces, and the documented environment variables:

```bash
npm run smoke:hermes:live
npm run smoke:opencode:live
npm run smoke:antigravity:live
```

Never place live credentials in repository files or shared shell history.
