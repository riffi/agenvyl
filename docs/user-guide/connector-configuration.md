# Connector configuration

Connector is the local Agenvyl component that starts or contacts agent tools
such as Codex CLI, Claude Code, OpenCode, AGY, Hermes, and Cursor CLI. Core sends
execution requests to Connector instead of calling those tools directly.

`connector.yaml` is Connector's local, versioned configuration file. It records
non-secret policy and harness selections: which tools are enabled, which room
workspace roots they may use, and a small number of harness-specific safety
choices.

For a normal personal installation, use **Configure connectors** or `agenvyl
setup` instead of editing this file. Agenvyl creates the initial file and
atomically rewrites it when you change connector or workspace settings.

## Where the file is stored

| Platform | Default path |
| --- | --- |
| Linux | `${XDG_CONFIG_HOME:-$HOME/.config}/agenvyl/connector.yaml` |
| macOS | `$HOME/Library/Application Support/Agenvyl/connector.yaml` |
| Windows | `%LOCALAPPDATA%\Agenvyl\connector.yaml` |

An operator can select another absolute path with
`AGENVYL_CONNECTOR_CONFIG`. This is normally needed only for development,
automation, or a custom deployment.

## How UI settings map to the file

| Action | YAML setting |
| --- | --- |
| Select the room workspace location | `workspaces.roots` |
| Add or remove a harness | `instances` |
| Enable or disable a harness | `instances[].enabled` |
| Let Agenvyl own the OpenCode server | `instances[].managed` |
| Approve an OpenCode external directory | `instances[].externalDirectoryRoots` |
| Confirm Claude subscription OAuth use | `instances[].allowSubscriptionOAuth` |

The file is application-managed. Saving a setting can normalize its formatting
and remove hand-written YAML comments. Connector reads the file when it starts;
manual changes are not reloaded while it is running.

## Example

```yaml
version: 1

listen:
  host: 127.0.0.1
  port: 4310

workspaces:
  roots:
    - /absolute/path/to/agenvyl/workspaces

instances:
  - id: local-codex
    type: codex
    enabled: true

  - id: local-opencode
    type: opencode
    enabled: false
    managed: true
    externalDirectoryRoots: []

  - id: local-claude
    type: claude
    enabled: false
    allowSubscriptionOAuth: false
```

The important sections are:

- `version` identifies the configuration format. The current value is `1`.
- `listen` is Connector's local HTTP address. The personal runtime uses the
  loopback address and manages its port; do not expose it to a network.
- `workspaces.roots` limits which room workspace trees Connector accepts.
- `instances` contains the enabled and disabled harness connections. Each `id`
  must be unique.

`externalDirectoryRoots` is an OpenCode-only allowlist. Adding a path expands
the directories that OpenCode may request outside a room workspace. An empty
list denies that external access.

`allowSubscriptionOAuth` records an explicit Claude Code subscription OAuth
choice. Leave it `false` unless you have read and accepted the confirmation in
the Claude setup flow.

`managed: true` means Connector starts and stops the OpenCode server. With
`managed: false`, an operator owns the server lifecycle and Connector only
attaches to it.

## What does not belong in YAML

Do not put tokens, passwords, provider API keys, OAuth credentials, executable
overrides, or shell commands in `connector.yaml`. Agenvyl keeps its generated
Connector token in `secrets.json`; harnesses normally keep authentication in
their own native credential stores. Custom deployments supply supported
credentials and executable overrides through environment variables.

Treat the file as private configuration even though it is intentionally
non-secret: absolute paths and enabled tools can still reveal information about
your computer. Do not commit it to source control or place it in a public cloud
folder.

## Manual editing

Manual editing is intended for development, recovery, and custom deployments.
For a personal installation:

1. Stop Agenvyl with `agenvyl stop`.
2. Copy `connector.yaml` to a safe backup.
3. Edit the original file. Use spaces, not tabs, and keep paths absolute.
4. Start Agenvyl with `agenvyl start`.
5. Run `agenvyl status` and, if startup fails, inspect
   `agenvyl logs connector --lines 200`.

Unknown fields, duplicate instance IDs, unsupported harness-specific fields,
and invalid paths are rejected instead of ignored. Restore the backup if the
new file does not load. The complete field reference and custom-deployment
environment variables are in [Connector operations](../operations/connector.md).

## Recover an unreadable file

If Connector cannot start after a manual change:

1. Run `agenvyl stop`.
2. Move `connector.yaml` to a backup name in the same directory; do not delete
   it.
3. Run `agenvyl start`. The personal supervisor creates a clean configuration
   because the original path is now missing.
4. Open **Configure connectors**, or run `agenvyl setup`, and restore the
   selections you need.

Moving the file aside resets saved workspace and harness selections, but it
does not delete rooms, workspace files, harness credentials, or the database.
Use the backup to compare and re-enter the previous non-secret settings.
