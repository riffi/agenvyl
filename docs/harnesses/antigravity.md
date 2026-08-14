# Connect Antigravity / AGY

## Before you start

Agenvyl requires a user-installed `agy` CLI `1.1.8` or newer. Use the
[official Antigravity installer](https://antigravity.google/docs/cli-install).

macOS and Linux:

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://antigravity.google/cli/install.ps1 | iex
```

Run `agy` once, complete browser authentication, trust only the workspace roots
you intend to use, and verify:

```bash
agy --version
```

## Connect it in Agenvyl

AGY is never selected automatically with the safe group because its execution
model cannot provide an approval round-trip.

1. Open the control center and choose **Configure connectors**.
2. Select **AGY**.
3. Confirm the dangerous AGY integration and save.
4. Create or edit an agent in the Web UI. New AGY agents use **Plan only**.

CLI fallback:

```bash
agenvyl setup
```

## Permissions and output

Each turn starts a separate `agy --print` process in the room workspace. After
the first turn, Agenvyl resumes the same native AGY conversation by its exact
conversation ID. This preserves AGY's session context without relying on the
workspace's most recently used conversation.

- **Plan only** is the safe per-agent default for read-only analysis.
- **Accept edits** is selected per agent and requires an explicit warning-dialog
  confirmation. It allows AGY to modify files without per-action approvals.
- Agenvyl's room **Plan** workflow always forces read-only AGY execution, even
  for an agent configured with **Accept edits**.

The former connector-level `permissionMode` field is no longer supported. Remove
it from existing `connector.yaml` files; the selected agent profile is persisted
instead.

AGY exposes a structured final result, which Agenvyl uses to capture the native
conversation ID. The connector currently displays only the final text and
terminal state; it does not invent partial output, tool activity, usage counters,
or approval events.

AGY manages retained conversations. When an Agenvyl continuation chain is no
longer active, the connector stops referencing it but does not delete it from
AGY's conversation history.

## Verify and troubleshoot

```bash
agy --version
agenvyl logs connector --lines 200
```

Override a non-standard executable:

```bash
export AGENVYL_CONNECTOR_AGY_COMMAND=/absolute/path/to/agy
```

The official Windows `.exe` is discovered through `PATH`. Connector disables
AGY auto-update for child executions and terminates the complete process tree
on cancellation.
