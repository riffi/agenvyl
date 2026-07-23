# Connect Codex CLI

## Before you start

Agenvyl requires a user-installed Codex CLI `0.145.0` or newer. It does not
bundle Codex or accept an OpenAI API key itself.

Install Codex using the
[official Codex documentation](https://developers.openai.com/codex/cli):

```bash
npm install --global @openai/codex
```

Authenticate and verify the same operating-system account that will run
Agenvyl:

```bash
codex login
codex --version
codex login status
```

Agenvyl uses the existing `CODEX_HOME`, preserving Codex configuration,
credentials, skills, apps, and MCP servers.

## Connect it in Agenvyl

1. Open the Agenvyl control center.
2. Choose **Configure connectors**.
3. Enable **Codex** and save.
4. Open the Web UI and go to **Agents**.
5. Create or edit an agent, then choose the Codex instance, model, reasoning
   effort, and permission profile.

CLI fallback:

```bash
agenvyl setup
```

Connector starts one restartable `codex app-server` and creates an ephemeral
thread for each Agenvyl attempt.

## Permissions

- **Workspace write** is the normal default. Codex can write within the room
  workspace and asks for actions outside the policy.
- **Read only** prevents workspace writes and keeps per-action approvals.
- **Danger full access** uses no Codex sandbox or approval prompt. Agenvyl hides
  it until the Connector instance is explicitly enabled with the exact
  `CODEX FULL ACCESS` confirmation.

Do not enable full access on a machine or workspace you do not fully trust.
Disable it only after reassigning every active and archived agent that uses it.

## Verify and troubleshoot

If Codex is not detected:

```bash
codex --version
codex login status
agenvyl logs connector --lines 200
```

An explicit executable override is available for non-standard installations:

```bash
export AGENVYL_CONNECTOR_CODEX_COMMAND=/absolute/path/to/codex
```

On Windows it may point to an `.exe`, `.cmd`, or `.bat` shim. Set the override
in the environment used to start Agenvyl, then restart the local runtime.

Codex app-server is an evolving interface. Agenvyl validates its supported
protocol at runtime, ignores unknown notifications, and fails closed on unknown
server requests.

