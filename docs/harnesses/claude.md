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

- **Ask before edits** uses Claude's normal approval flow.
- **Accept edits** permits edits without an edit-by-edit prompt.
- Experimental Plan Mode selects Claude's Plan permission mode.

Agenvyl intentionally does not pass `--bare`. Normal user, project, and local
settings, `CLAUDE.md`, skills, plugins, hooks, MCP configuration, provider
credentials, and Claude telemetry behavior remain active.

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

