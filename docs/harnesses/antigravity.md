# Connect Antigravity / AGY

## Before you start

Agenvyl requires a user-installed `agy` CLI `1.1.3` or newer. Use the
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
3. Keep **Plan** mode unless you explicitly need file edits.
4. Save, then create or edit an agent in the Web UI.

CLI fallback:

```bash
agenvyl setup
```

## Permissions and output

Each attempt starts a fresh `agy --print` process in the room workspace.

- **Plan** is the safe default for read-only analysis.
- **Accept edits** passes AGY's dangerous permission-bypass flag and requires an
  explicit Agenvyl confirmation.

AGY does not expose a documented structured streaming and approval protocol.
Agenvyl therefore displays the final text and terminal state only. It does not
invent partial output, tool activity, usage counters, or approval events.

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

