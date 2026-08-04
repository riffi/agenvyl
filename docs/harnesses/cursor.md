# Connect Cursor CLI

> [!WARNING]
> Cursor CLI support is experimental. It has no documented approval round-trip
> for headless runs. Cursor rules, MCP servers, and hooks remain active.

## Before you start

Agenvyl requires Cursor CLI `2026.01.16` or newer on macOS, Linux, WSL, or
native Windows. Install and
authenticate Cursor using the [official CLI documentation](https://cursor.com/docs/cli),
then verify it yourself:

```bash
agent --version
agent status
agent --list-models
```

`cursor-agent` is accepted as a backward-compatible command alias. Agenvyl does
not log in to Cursor, store Cursor credentials, or update Cursor CLI. An existing
browser login or `CURSOR_API_KEY` in the Connector environment is used by Cursor
itself.

## Connect it in Agenvyl

1. Open **Configure connectors** and select **Cursor CLI**.
2. Review the experimental warning and enter `CURSOR`.
3. Save, then create or edit an agent using the Cursor instance and model.
4. Keep **Plan only** unless you explicitly need the agent to edit files.

Each attempt starts a fresh headless Cursor process in the room workspace.
Agenvyl remains the canonical conversation store and does not resume Cursor
sessions.

## Permissions and observable output

- **Plan only** uses Cursor's native Plan mode and is the default. Agenvyl passes
  `--trust` for its already confirmed room workspace so headless Cursor does not
  block on an interactive workspace-trust prompt.
- **Accept edits** requires a separate per-agent warning confirmation. Work runs
  use Cursor's `--force` flag and cannot request per-action approval in Agenvyl.
- Agenvyl's global Plan workflow always selects native Plan mode, even for an
  agent saved with **Accept edits**.

Agenvyl streams assistant text and tool activity from Cursor's documented
[`stream-json` output](https://docs.cursor.com/en/cli/reference/output-format).
Headless Cursor suppresses thinking and does not expose a
documented usage or interactive request protocol, so Agenvyl does not invent
reasoning, usage, approval, or clarification events.

Cursor project and user rules, MCP servers, hooks, network behavior, and
telemetry remain active with the permissions of the operating-system account.
Plan Mode is not an operating-system sandbox; review that configuration before
connecting untrusted workspaces.

## Troubleshooting

```bash
agent --version
agent status
agent --list-models
agenvyl logs connector --lines 200
```

For a non-standard installation, set this in the environment that starts
Agenvyl and restart the runtime:

```bash
export AGENVYL_CONNECTOR_CURSOR_COMMAND=/absolute/path/to/agent
```

Unknown model-list or stream events are handled conservatively. An incompatible
catalog or terminal protocol makes the harness unavailable instead of falling
back to terminal-text scraping.
