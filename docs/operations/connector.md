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
non-secret instance definitions. Loopback endpoints, managed OpenCode state, and
the explicit AGY permission mode, and the Codex full-access opt-in may be persisted. Tokens, passwords, executable
paths, and OAuth state remain in the process environment or native harness stores.
Unknown YAML fields are rejected.

The bearer-protected `GET /v1/discovery` reports local CLI/endpoint readiness.
`PUT /v1/instances` atomically persists a validated selection and applies its
adapter lifecycle. Hermes is attach-only; OpenCode can attach to an endpoint or
run as a Connector-managed `opencode serve` child.

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

The personal portable runtime uses the repository's Node-based supervisor. A
server deployment may still use systemd, a container sidecar, or a manual
process, provided that Connector keeps access to the host harness runtimes and
canonical room workspaces.

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

## Codex CLI

Install Codex CLI `0.145.0` or newer and sign in using the normal user account
(see [Codex authentication](https://developers.openai.com/codex/auth)):

```bash
npm install --global @openai/codex
codex login
codex --version
codex login status
```

The default browser login uses the user's ChatGPT account and workspace, so
app-server runs can use the Codex access included with that ChatGPT plan. API-key
login remains a Codex CLI feature but Agenvyl does not accept or store API keys.
The connector uses the existing `CODEX_HOME`, preserving the user's Codex config,
skills, MCP servers, apps, and credentials.

Each Codex instance owns one restartable [`codex app-server`](https://developers.openai.com/codex/app-server)
process launched as `codex app-server --listen stdio://`
process and multiplexes ephemeral threads over its JSONL/JSON-RPC transport.
Agenvyl remains the canonical conversation store and sends bounded room history
as developer context for each attempt. Override the executable without putting it
in public YAML:

```bash
export AGENVYL_CONNECTOR_CODEX_COMMAND="$HOME/.local/bin/codex"
```

On Windows the override may point to an `.exe`, `.cmd`, or `.bat` shim. The
connector terminates the full process tree on shutdown and restarts a crashed
app-server on the next catalog or run request.

Codex modes combine sandbox and reasoning effort. `read-only/*` and
`workspace-write/*` use approval policy `on-request`; `danger-full-access/*`
uses approval policy `never` and is hidden unless the instance setting is
explicitly enabled with `CODEX FULL ACCESS`. Disable that setting only after
reassigning all active and archived personas that use a full-access mode.

Codex App Server is currently experimental. Agenvyl therefore enforces a version
floor, validates the narrow protocol at runtime, ignores unknown notifications,
and fails closed on unknown server requests. Agenvyl does not bundle Codex CLI or
the Codex SDK and does not enable first-party app-server analytics.

## Claude Code CLI (experimental)

Install and authenticate Claude Code CLI `2.1.217` or newer yourself, then verify
the account and environment used by Connector:

```bash
claude --version
claude auth status
```

Connector runs one ephemeral process per execution using `--print`, bidirectional
`stream-json`, partial messages, and `--no-session-persistence`. Runs therefore do
not appear in Claude resume history. Model and effort choices come from the CLI's
runtime `initialize` response; incompatible versions remain unavailable even when
their version number is new enough. Override an installation path with:

```bash
export AGENVYL_CONNECTOR_CLAUDE_COMMAND="$HOME/.local/bin/claude"
```

Windows `.exe`, `.cmd`, and `.bat` installations are supported without inserting
the prompt or model into an interpolated shell command. Cancellation sends a
protocol interrupt first, then terminates the complete POSIX process group or
Windows process tree if the CLI does not exit.

Agenvyl does not pass `--bare`: Claude's normal user, project, and local settings,
`CLAUDE.md`, skills, plugins, hooks, MCP configuration, provider credentials, and
telemetry behavior remain in effect. Agenvyl adds no telemetry of its own for this
adapter, but it does not disable telemetry or hooks configured by Claude.

API keys and supported cloud-provider authentication need no special Agenvyl
confirmation. Subscription OAuth is never selected automatically and requires the
exact phrase `CLAUDE OAUTH`; the confirmation is stored as
`allowSubscriptionOAuth: true`, separately from credentials. This opt-in does not
change Anthropic's terms. Anthropic states that third-party products should use
API/cloud authentication and should not route Free/Pro/Max credentials, so a public
experimental OAuth deployment carries a deliberate policy and terms risk. See the
official [CLI reference](https://code.claude.com/docs/en/cli-usage),
[headless mode](https://code.claude.com/docs/en/headless),
[permission modes](https://code.claude.com/docs/en/permission-modes), and
[legal and compliance guidance](https://code.claude.com/docs/en/legal-and-compliance).

Claude is not part of the portable payload. Agenvyl neither bundles the Claude
binary nor depends on `@anthropic-ai/claude-agent-sdk` or its platform packages.

## Antigravity / AGY

Install and authenticate `agy >= 1.1.3`, trust the configured workspace root,
and enable `local-antigravity`. AGY is never included in the safe-all selection;
the browser requires a separate confirmation and stores `permissionMode: plan`
by default (or the explicitly selected `accept-edits`):

```bash
agy
export AGENVYL_CONNECTOR_AGY_COMMAND="$HOME/.local/bin/agy"
export AGENVYL_CONNECTOR_AGY_PRINT_TIMEOUT_MS=1800000
```

On Windows, the official `agy.exe` distribution is discovered from `PATH`.
An explicit path can be configured with
`AGENVYL_CONNECTOR_AGY_COMMAND=C:\path\to\agy.exe`.

The timeout should be longer than Core's `AGENVYL_RUN_TIMEOUT_MS`, so Core owns
the product deadline. Connector disables AGY auto-update for child processes.

Each attempt starts a fresh `agy --print` process in the room workspace with an
exact model and either `plan` or `accept-edits` mode. The explicit opt-in passes
`--dangerously-skip-permissions`; Agenvyl cannot provide an approval round-trip
for AGY. Prefer `plan` for read-only work.

The CLI does not expose a documented structured event protocol. The adapter
therefore publishes final text and terminal state only, does not fabricate
tools or usage, and bounds prompt/stdout/stderr sizes. Cancellation terminates
the detached POSIX process group with TERM followed by KILL; on Windows it
terminates the complete process tree with `taskkill /T` and escalates to `/F`
after the configured grace period.

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
npm run test:codex
npm run test:e2e:codex
npm run test:claude
npm run test:e2e:claude
```

Live smoke tests are opt-in and require separately running harnesses, isolated
workspaces, and the documented environment variables:

```bash
npm run smoke:hermes:live
npm run smoke:opencode:live
npm run smoke:antigravity:live
npm run smoke:codex:live
npm run smoke:claude:live
```

Never place live credentials in repository files or shared shell history.
