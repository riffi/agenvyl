# Install and start Agenvyl

This guide is for the downloadable, local Agenvyl app. It runs on a trusted
single-user computer and includes its own Node.js and PostgreSQL. You do not
need Docker, npm, or a source checkout.

Supported packages are available for:

- Windows 10/11 x64;
- Linux x64 and arm64; and
- macOS on Intel and Apple silicon.

You can install Agenvyl without an agent tool, but you need at least one
[supported harness](../harnesses/README.md) to receive agent responses.

## Recommended installation

The installer selects the correct archive, checks its declared size and
SHA-256 digest, initializes the local runtime, and opens the setup screen.

### Windows

Open PowerShell:

```powershell
irm https://github.com/riffi/agenvyl/releases/latest/download/install.ps1 | iex
```

### Linux and macOS

Open a terminal:

```bash
curl -fsSL https://github.com/riffi/agenvyl/releases/latest/download/install.sh | sh
```

The current Technical Preview is unsigned. Read
[Trust and security](trust-and-security.md) before accepting a SmartScreen or
Gatekeeper warning.

Use `AGENVYL_NO_LAUNCH=1`, `--no-launch`, or PowerShell `-NoLaunch` for an
unattended install that should not start Agenvyl. Use `AGENVYL_NO_PATH=1`,
`--no-path`, or `-NoPath` to skip the user command shim.

## Install a specific version

Use this only when you need an older release or an exact version for
reproducibility. Find the version on the
[Agenvyl releases page](https://github.com/riffi/agenvyl/releases) and omit the
leading `v`.

On Windows:

```powershell
$version = '<release-version>'
$env:AGENVYL_VERSION = $version
irm "https://github.com/riffi/agenvyl/releases/download/v$version/install.ps1" | iex
```

On Linux or macOS:

```bash
VERSION=<release-version>
curl -fsSL "https://github.com/riffi/agenvyl/releases/download/v${VERSION}/install.sh" |
  sh -s -- --version "$VERSION"
```

The version setting applies to this installation command. Running the normal
Quick Start later selects the latest release again.

## Install from an archive

Use this path when you do not want the installer to modify your user `PATH`.

1. Open the latest GitHub release and download the archive for your system.
2. Verify its checksum and provenance as described in
   [Trust and security](trust-and-security.md).
3. Extract it to a user-writable directory. Paths containing spaces and Unicode
   are supported.
4. Start the control center with the platform launcher:

   | Platform | Launcher |
   | --- | --- |
   | Windows | `Start Agenvyl.cmd` |
   | Linux | `Start Agenvyl.sh` |
   | macOS | `Start Agenvyl.command` |

The archive also includes `Stop`, `Status`, and `Uninstall` launchers. Manual
archive installation does not create the stable `agenvyl` command until the
control center runs **Install / repair** with user command integration enabled.

## Complete first-run setup

On first start, Agenvyl:

1. creates user-only configuration and secrets;
2. initializes its personal PostgreSQL cluster;
3. starts PostgreSQL, Connector, and Core;
4. detects supported agent tools already installed on the computer; and
5. opens <http://127.0.0.1:8791/setup>.

In the setup screen:

1. review the detected harnesses and keep only the ones you trust;
2. read and accept any tool-specific permission warning;
3. enter your display name;
4. name the first room; and
5. finish setup.

When a harness is available, Agenvyl creates editable **Architect**,
**Builder**, and **Reviewer** starter agents. Open **Agents** to change their
models, instructions, and permission profiles.

If the browser does not open, visit <http://127.0.0.1:8791>. If setup cannot
find a tool, use its [harness guide](../harnesses/README.md).

## Send the first message

Address all agents connected to the room:

```text
@all Propose the best approach to this task from your perspective.
```

Agents addressed in the same message run independently. After they finish, ask
one agent to compare their answers:

```text
@reviewer Read the answers above and synthesize the best result.
```

A message without an `@mention` is saved in the room but starts no agent.

## Control the local runtime

Run `agenvyl` without arguments to open the control center. Common direct
commands are:

```bash
agenvyl start
agenvyl status
agenvyl doctor
agenvyl logs supervisor --lines 100
agenvyl stop
```

`agenvyl start` starts the stack without opening a browser. The control center
can also configure connectors, create backups, restore a database, and
uninstall the app.

Next, learn [where Agenvyl stores data and how to back it up](data-and-backups.md).
