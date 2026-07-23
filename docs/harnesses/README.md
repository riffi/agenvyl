# Connect an agent tool

Agenvyl does not include model access. It coordinates coding-agent tools already
installed and authenticated for your operating-system user.

Open the Agenvyl control center and choose **Configure connectors**. During
first-run setup, the same selection appears in the browser. Agenvyl can
automatically detect Codex CLI, Claude Code, OpenCode, and AGY. Hermes is
different: its HTTP API server must already be running.

| Harness | Connection | Main safety boundary |
| --- | --- | --- |
| [Codex CLI](codex.md) | Agenvyl starts `codex app-server` | Workspace sandbox and approval policy |
| [Claude Code](claude.md) *(experimental)* | One `claude` process per attempt | Permission mode and authentication policy |
| [OpenCode](opencode.md) | Managed or existing OpenCode server | OpenCode permissions and external-directory rejection |
| [Antigravity / AGY](antigravity.md) | One `agy --print` process per attempt | Plan by default; edits require explicit opt-in |
| [Hermes](hermes.md) | Existing authenticated HTTP API | Hermes host permissions and configured model routes |

Compare model controls, streaming, reasoning, tool activity, interactions, and
run lifecycle behavior in the
[harness capability matrix](capabilities.md).

After adding a harness, open **Agents** in the Web UI. Create or edit an agent,
choose the harness instance and model, then add that agent to a room.

## Common checks

If a harness does not appear:

1. run its version and authentication checks from the matching guide;
2. open a new terminal so an updated `PATH` is visible;
3. start Agenvyl from the same user account and environment;
4. reopen **Configure connectors** or run `agenvyl setup`; and
5. inspect `agenvyl logs connector --lines 200`.

Harnesses keep their own settings, credentials, tools, skills, plugins, hooks,
MCP servers, network behavior, and telemetry. Agenvyl adds no telemetry of its
own, but it does not disable behavior configured in the harness.
