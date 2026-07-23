# Connect Claude Code

> [!WARNING]
> Claude Code support is experimental. Prefer Anthropic Console API
> authentication or a supported cloud provider. Subscription OAuth requires a
> separate Agenvyl confirmation and may not be permitted for every third-party
> orchestration use case.

## Before you start

Agenvyl requires a user-installed Claude Code CLI `2.1.217` or newer. Follow the
[official setup guide](https://docs.anthropic.com/en/docs/claude-code/getting-started),
then check the installation and account:

```bash
claude --version
claude auth status
claude doctor
```

Use the same operating-system account that runs Agenvyl.

## Authentication choices

API keys and supported Amazon Bedrock or Google Vertex AI authentication need
no Agenvyl-specific confirmation.

Anthropic states that third-party products should use API or supported cloud
authentication rather than routing Free, Pro, or Max subscription credentials.
If you deliberately use subscription OAuth, Agenvyl requires the exact
`CLAUDE OAUTH` confirmation and stores only the opt-in flag, not the credential.
Review Anthropic's
[legal and compliance guidance](https://code.claude.com/docs/en/legal-and-compliance).

## Connect it in Agenvyl

1. Open the control center and choose **Configure connectors**.
2. Enable **Claude**.
3. If the detected account uses subscription OAuth, read the warning and enter
   the required confirmation.
4. Save the Connector selection.
5. In **Agents**, select the Claude instance, model, reasoning effort, and
   permission profile.

CLI fallback:

```bash
agenvyl setup
```

Each attempt starts a fresh `claude` process with no resumable Claude session.
Agenvyl supplies bounded room history and remains the canonical conversation
store.

## Permissions and preserved settings

- **Ask before edits** sends unresolved Claude tool permissions to the
  Agenvyl room.
- **Accept edits** permits edits without an edit-by-edit prompt.
- **Allow for session** applies only to the current Agenvyl execution and is
  not written into Claude Code settings.
- Experimental Plan Mode selects Claude's Plan permission mode.

Agenvyl intentionally does not pass `--bare`. Normal user, project, and local
settings, `CLAUDE.md`, skills, plugins, hooks, MCP configuration, provider
credentials, and Claude telemetry behavior remain active.

## Agenvyl permission bridge

Agenvyl handles Claude Code approval requests through an internal MCP
permission bridge. No manual Claude Code configuration is required. Agenvyl
does not run `claude mcp add` and does not modify `~/.claude.json`, project
`.mcp.json` files, or Claude Code settings.

Connector starts one loopback-only MCP server when the first Claude execution
needs it and reuses that server for later executions. For each Claude
execution, Agenvyl:

1. creates a run-scoped bearer token;
2. writes a temporary MCP configuration;
3. passes it to the child `claude` process through `--mcp-config`;
4. selects the Agenvyl permission tool through
   `--permission-prompt-tool`; and
5. removes the token and temporary configuration when the execution finishes.

The bridge converts Claude tool permissions and questions into approval or
clarification cards in the Agenvyl room. The user's decision is returned only
to the matching Claude execution. Stopping the execution cancels its pending
requests.

Existing user and project MCP servers remain available because Agenvyl does
not pass `--strict-mcp-config`. The injected permission server applies only to
Claude processes started by Agenvyl and does not affect ordinary terminal
sessions.

Claude Code authentication remains owned by the installed CLI. The permission
bridge does not read, copy, or replace its OAuth or API credentials.

## Verify and troubleshoot

```bash
claude --version
claude auth status
agenvyl logs connector --lines 200
```

Override a non-standard executable path in the Agenvyl launch environment:

```bash
export AGENVYL_CONNECTOR_CLAUDE_COMMAND=/absolute/path/to/claude
```

Windows `.exe`, `.cmd`, and `.bat` installations are supported. Unknown or
incompatible initialization responses make the harness unavailable rather than
guessing at behavior.
