# Agenvyl

**One browser. Multiple coding agents. One shared workspace.**

Agenvyl is a local web interface that brings your already-installed coding-agent
harnesses into shared rooms. Each harness keeps the capabilities already
available in its own environment—models, skills, tools, and MCP integrations
where supported—while Agenvyl coordinates the conversation, parallel runs, and
shared files.

Completed answers stay in the room context, so later agents can read, critique,
and synthesize the work produced by earlier agents.

![Technical Preview](https://img.shields.io/badge/status-technical_preview-f59e0b?style=flat-square)
![Local-first](https://img.shields.io/badge/local--first-no_telemetry-22c55e?style=flat-square)
![Platforms](https://img.shields.io/badge/platform-Windows_%7C_macOS_%7C_Linux-3b82f6?style=flat-square)
[![License](https://img.shields.io/badge/license-Apache_2.0-6d5ef7?style=flat-square)](LICENSE)

**[Get started](#quick-start)** · [See how it works](#how-agenvyl-works) ·
[Supported harnesses](#supported-coding-agent-harnesses) ·
[Read the documentation](#documentation)

![Agenvyl Web UI showing three coding agents answering in parallel](docs/assets/agenvyl-overview.png)

*Three different models, two agent harnesses, one shared conversation and
workspace.*

## Coding agents work better together

Coding agents usually live in separate terminals and chats. Their context,
files, and decisions become fragmented, and comparing their work means jumping
between windows.

Agenvyl gives the team one browser-based room. Call an agent by name, ask
several agents at once, or use `@all`; every answer remains connected to the
same conversation and working folder.

## Why Agenvyl?

| | |
| --- | --- |
| **Shared context**<br>Later agents can read earlier answers, evaluate competing ideas, and synthesize a stronger result. | **Parallel by default**<br>Mention several agents in one message and let them explore the same task at the same time. |
| **Shared files**<br>Agents in a room work with the same attachments, generated files, and versions. | **Keep your existing setup**<br>Reuse each harness with its configured models, skills, tools, and MCP integrations. |

## How Agenvyl works

![Diagram showing one message running several agents in an Agenvyl room and collecting their results](docs/assets/how-agenvyl-works.svg)

1. **Create a room** for a project, bug, review, or experiment and add the
   agents you need.
2. **Send one message** to `@architect`, a few selected agents, or `@all`.
   Mentioned agents run in parallel against the same conversation and files.
3. **Review and synthesize** in the next turn. Once parallel runs finish, ask an
   agent to read the answers above, evaluate them, and produce a combined result.

Agents launched in the same round start from the same pre-round conversation
context; they do not wait for one another. Their completed answers then become
part of the room history available to later turns.

A message without an `@mention` is saved in the conversation but does not start
an agent.

## Built for real workflows

Rooms are not limited to software projects. Any task that benefits from distinct
roles, parallel perspectives, and a shared history can use the same pattern.

| Workflow | Example team |
| --- | --- |
| **Build software** | An architect proposes the design, a builder implements it, and a reviewer checks the result. |
| **Explore a topic** | Researchers investigate different angles, a skeptic challenges weak claims, and an editor summarizes the findings. |
| **Write creatively** | A plotter, character specialist, and editor develop and revise a story in the same room. |
| **Review a document** | A domain expert, fact-checker, and editor critique the same draft from different perspectives. |
| **Plan and decide** | Independent planners propose options, a critic stress-tests them, and a lead synthesizes the decision. |
| **Compare models** | Ask the same question once and compare model answers side by side. |
| **Talk with your agents** | Keep an ongoing conversation with recurring personas; address one specialist, a few of them, or `@all`. |

## Supported coding-agent harnesses

Agenvyl currently supports:

- **Hermes** — connects to an already running local Hermes HTTP service.
- **OpenCode** — connects to an existing server or starts a managed local server.
- **Codex CLI** — starts the user-installed `codex app-server` and preserves its
  account, configuration, skills, apps, and MCP servers.
- **Claude Code CLI (experimental)** — starts the user-installed `claude` CLI and
  preserves its settings, provider credentials, skills, plugins, hooks, and MCP
  servers. Read the authentication warning below before enabling it.
- **Antigravity (AGY)** — starts the user-installed CLI with an explicit
  permission-mode confirmation.

Agenvyl does not replace or reconfigure these harnesses: each remains the
execution environment and keeps its own accounts, models, skills, tools, and MCP
servers where supported. Agenvyl adds the coordination layer—rooms, mentions,
parallel runs, a shared timeline, and a shared workspace.

Agenvyl does not provide model access by itself. It discovers the models,
reasoning efforts, permission profiles, and provider agent variants exposed by
the harnesses already authenticated on your computer.

One connected harness can power several Agenvyl agents with different names,
roles, models, base permissions, provider variants, and instructions. Plan/Work
and reasoning effort belong to each room and can be changed beside the composer.

### Claude authentication warning

> [!WARNING]
> **Using the official Claude CLI does not make every authentication method
> permitted for third-party orchestration.** Agenvyl launches your normal,
> user-installed `claude` executable, but Anthropic says developers of
> third-party products should use API keys or supported cloud-provider
> authentication and must not route Free, Pro, or Max subscription credentials
> on behalf of users. Anthropic also reserves the right to enforce this
> restriction without notice. See Anthropic's
> [legal and compliance guidance](https://code.claude.com/docs/en/legal-and-compliance).
>
> Agenvyl therefore treats Claude subscription OAuth as an experimental,
> explicit opt-in. It is disabled until you enter `CLAUDE OAUTH`. Prefer an
> Anthropic Console API key or a supported cloud provider if you want to avoid
> this terms-and-access risk.

Claude Code can also be configured to use a third-party API provider. For
example, Z.AI documents running the Claude CLI with GLM models through its own
API endpoint and credentials in its
[Claude Code guide](https://docs.z.ai/devpack/tool/claude). This avoids the
specific risk of routing Anthropic subscription OAuth credentials because those
credentials are not used. Agenvyl inherits the CLI's environment and settings,
so no Agenvyl-specific provider configuration is needed; the provider's own
compatibility, data handling, and terms still apply.

## Quick start

The downloadable app already includes Node.js and PostgreSQL. You do **not**
need Docker, npm, or a source checkout.

Supported systems are Windows 10/11 x64, Linux x64 or arm64, and macOS on Intel
or Apple Silicon. To receive agent responses, have at least one supported agent
tool installed and authenticated on the same computer; you can also finish
setup without an agent and connect one later.

> [!WARNING]
> **Agenvyl v0.1.0 is an unsigned Technical Preview** for a trusted,
> single-user computer. Windows SmartScreen or macOS Gatekeeper may show a
> warning. Read the [Technical Preview trust guide](docs/operations/preview-trust.md)
> before accepting it.

<details open>
<summary><strong>Windows</strong></summary>

Open PowerShell and run:

```powershell
irm https://github.com/riffi/agenvyl/releases/latest/download/install.ps1 | iex
```

</details>

<details>
<summary><strong>Linux</strong></summary>

Open a terminal and run:

```bash
curl -fsSL https://github.com/riffi/agenvyl/releases/latest/download/install.sh | sh
```

</details>

<details>
<summary><strong>macOS</strong></summary>

Open Terminal and run:

```bash
curl -fsSL https://github.com/riffi/agenvyl/releases/latest/download/install.sh | sh
```

</details>

After installation, Agenvyl starts and opens the guided setup automatically.
Choose the detected agent connections, enter your display name, and name your
first room. Open a new terminal before using the `agenvyl` command directly.

For unattended installation without starting Agenvyl, set
`AGENVYL_NO_LAUNCH=1` (or pass `--no-launch` to `install.sh` / `-NoLaunch` to
`install.ps1`).

If the browser does not open, go to <http://127.0.0.1:8791>.

When a connection is available, Agenvyl creates three editable starter agents:
**Architect**, **Builder**, and **Reviewer**.

## Your first room

Start all agents connected to the room with one message:

```text
@all Propose the best approach to this task from your perspective.
```

Then ask one agent to turn the parallel answers into a decision:

```text
@reviewer Read the answers above, evaluate their trade-offs, and synthesize the best plan.
```

Or guide a workflow agent by agent:

```text
@architect Read the project and propose a safe implementation plan.
@builder Implement the agreed plan and run the tests.
@architect @reviewer Check the change from different perspectives.
```

## What stays in a room

| Rooms | Agents | Files and runs |
| --- | --- | --- |
| Separate workspaces for projects and tasks.<br><br>Completed answers become context that later agents can review and build on. | Give each agent a name, `@handle`, role, model, permissions, provider variant, and its own instructions.<br><br>Only agents added to a room can be mentioned there. | Switch Plan/Work and effort in the room, approve an authoritative plan, attach files, answer clarifications, retry responses, and compare attempts.<br><br>Generated files and file versions remain on your computer. |

Open **New room** in the sidebar to create another workspace, **Agents** to
manage the agent catalog, or **Workspace** to inspect the room's files.

## Local-first by design

- The Web UI, product state, room history, and workspaces run on your computer.
- Agenvyl does not send telemetry or remote analytics.
- Connected harnesses use your normal user permissions. A room workspace is a
  shared working directory, **not a security sandbox**.
- Do not connect an agent you would not trust to work on the selected files.
- AGY is never enabled automatically because it starts a separate process with
  a dangerous permission flag; enabling it requires explicit confirmation.
- Codex defaults to workspace-write with per-action approvals. Unsandboxed
  `danger-full-access` modes require the exact `CODEX FULL ACCESS` confirmation.
- Claude uses the user-installed CLI and is experimental. API or supported cloud
  authentication is preferred; see the
  [Claude authentication warning](#claude-authentication-warning).

<details>
<summary><strong>Starting, stopping, and backing up Agenvyl</strong></summary>

Run the control center:

```bash
agenvyl
```

It can start Agenvyl, open the Web UI, stop services, show diagnostics, create a
backup, or remove the app. Useful direct commands are:

```bash
agenvyl start
agenvyl status
agenvyl stop
agenvyl backup
```

`agenvyl start` starts the services without opening a browser. Open
<http://127.0.0.1:8791> yourself when using that command.

</details>

## Documentation

The README covers the normal product journey. Technical and operator details
live in focused guides:

- [Portable runtime, backups, restore, and uninstall](docs/operations/portable-runtime.md)
- [Build and test the Windows installer locally](docs/operations/windows-local-installer.md)
- [Connecting Hermes, OpenCode, Codex, Claude, and AGY](docs/operations/connector.md)
- [Architecture](docs/architecture/overview.md)
- [Runtime operations](docs/operations/runtime.md)
- [Database operations](docs/operations/database.md)
- [Development and contributions](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Ready to try Agenvyl?

Install Agenvyl, connect one of your existing coding-agent tools, and create a
room where your agents can work together.

**[Start with the quick start](#quick-start)** ·
[Read the documentation](#documentation) ·
[Report an issue](https://github.com/riffi/agenvyl/issues)

Agenvyl is licensed under the [Apache License 2.0](LICENSE).
