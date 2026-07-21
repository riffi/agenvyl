# Agenvyl

Agenvyl is a local workspace where you can talk to several coding agents in one
room.

Instead of opening a separate terminal or chat for every agent, you create a
room for a task, add the agents you need, and call them by name. They can answer
in parallel, work with the same files, and keep the whole discussion in one
place.

Agenvyl currently works with **Hermes**, **OpenCode**, and **Antigravity (AGY)**.
It uses the tools and accounts already configured on your computer; Agenvyl does
not provide model access by itself.

> Agenvyl v0.1.0 is an unsigned Technical Preview for a trusted, single-user
> computer. It runs locally and does not send telemetry. Windows SmartScreen or
> macOS Gatekeeper may show a warning. Read the
> [Technical Preview trust guide](docs/operations/preview-trust.md) before
> accepting it.

## What you can do

- Create separate rooms for projects, bugs, reviews, or experiments.
- Give each agent a name, role, model, and its own instructions.
- Ask one agent, several specific agents, or everyone in the room.
- Receive parallel answers without losing the shared conversation.
- Retry an answer and compare attempts.
- See tool activity, answer clarification questions, and approve actions when
  the connected agent supports it.
- Attach files and let agents read or update the room workspace.
- Keep room history, generated files, and file versions on your computer.

A room is both a conversation and a shared working folder. It is useful for
workflows such as:

- ask an architect to inspect a task;
- ask a builder to implement it;
- ask a reviewer to check the result;
- let all three discuss the same problem in parallel.

## Before you install

The downloadable app already includes Node.js and PostgreSQL. You do **not**
need Docker, npm, or a source checkout.

Supported systems:

- Windows 10/11 x64;
- Linux x64 or arm64;
- macOS on Intel or Apple Silicon.

To receive agent responses, have at least one supported agent tool installed and
authenticated on the same computer. The setup screen will show what Agenvyl can
find. You may also finish setup without an agent and connect one later.

## Quick start

### Windows

1. Open **PowerShell** and run:

   ```powershell
   irm https://github.com/riffi/agenvyl/releases/latest/download/install.ps1 | iex
   ```

2. Close PowerShell and open it again so the new `agenvyl` command is available.

3. Start the first-time setup:

   ```powershell
   agenvyl setup
   ```

### Linux

1. Open a terminal and run:

   ```bash
   curl -fsSL https://github.com/riffi/agenvyl/releases/latest/download/install.sh | sh
   ```

2. Close the terminal and open it again.

3. Start the first-time setup:

   ```bash
   agenvyl setup
   ```

### macOS

1. Open **Terminal** and run:

   ```bash
   curl -fsSL https://github.com/riffi/agenvyl/releases/latest/download/install.sh | sh
   ```

2. Close Terminal and open it again.

3. Start the first-time setup:

   ```bash
   agenvyl setup
   ```

## Finish setup in the browser

`agenvyl setup` does the following:

1. starts Agenvyl and its local database;
2. looks for Hermes, OpenCode, and AGY on your computer;
3. asks whether to use the safely detected connections;
4. opens the Web UI in your browser.

If the browser does not open, go to:

<http://127.0.0.1:8791>

On the setup page:

1. choose the detected agent connections you want to use;
2. enter your display name and handle;
3. name your first room;
4. click **Create workspace**.

When an agent connection is available, Agenvyl creates three starter agents:
**Architect**, **Builder**, and **Reviewer**. You can edit or remove them later.
AGY is never enabled automatically because it starts a separate process with a
dangerous permission flag; enabling it requires a separate confirmation.

## Your first conversation

Open the first room and type a message with an agent mention:

```text
@architect Read the project and propose a safe implementation plan.
```

Call a different agent:

```text
@builder Implement the agreed plan and run the tests.
```

Call several agents at once:

```text
@architect @reviewer Check this change from different perspectives.
```

Call every agent connected to the room:

```text
@all Review the current state and tell me what should happen next.
```

Agents mentioned in the same message run in parallel. A message without an
`@mention` is saved in the room but does not start an agent.

## Rooms and agents

### Rooms

Use **New room** in the sidebar to create a workspace for a new task. Choose
which agents belong to it. Only agents added to a room can be mentioned there.

Each room keeps:

- the conversation;
- agent responses and retries;
- attached and generated files;
- the agents currently working on the task.

### Agents

Open **Agents** in the sidebar to create or edit an agent. You can choose:

- its name and `@handle`;
- its role in the team;
- the connected tool and model it uses;
- optional instructions that define how it should behave.

For example, one OpenCode or Hermes installation can power several Agenvyl
agents with different roles and instructions.

### Files

Attach a file from the message composer or open the room workspace. Agents in
the room work with the same files. Files created or changed during a run appear
in the Web UI, and workspace images can be shown directly inside an answer.

Agenvyl keeps file versions, but the workspace is **not a security sandbox**.
Connected agents run with your normal user permissions. Do not connect an agent
you would not trust to work on the selected files.

## Starting Agenvyl later

Run the control center:

```bash
agenvyl
```

Choose **Start**. When Agenvyl is ready, the Web UI opens in your browser.
The same control center can open the UI, stop Agenvyl, show diagnostics, create a
backup, or remove the app.

Useful direct commands:

```bash
agenvyl start
agenvyl status
agenvyl stop
agenvyl backup
```

`agenvyl start` starts the services without opening a browser. Open
<http://127.0.0.1:8791> yourself when using that command.

## Need more detail?

The README intentionally covers the normal user journey. Technical and
operator documentation lives here:

- [Portable runtime, backups, restore, and uninstall](docs/operations/portable-runtime.md)
- [Connecting Hermes, OpenCode, and AGY](docs/operations/connector.md)
- [Architecture](docs/architecture/overview.md)
- [Runtime operations](docs/operations/runtime.md)
- [Database operations](docs/operations/database.md)
- [Development and contributions](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

Agenvyl is licensed under the [Apache License 2.0](LICENSE).
