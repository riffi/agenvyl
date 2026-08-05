# Command line and terminal control center

The `agenvyl` command manages the local Agenvyl application. It starts and
stops the bundled services, opens the terminal control center, checks health,
reads logs, manages database backups, and removes or repairs the installation.

It is separate from the coding-agent CLIs that Agenvyl connects to. Commands
such as `codex`, `claude`, `opencode`, `agy`, and `agent` run the upstream agent
tools. The `agenvyl` command manages Agenvyl itself.

Use the interfaces for different jobs:

| Interface | Use it for |
| --- | --- |
| Web UI | Rooms, messages, agents, projects, and Workspace files |
| Terminal control center (TUI) | Interactive local application management |
| Direct CLI commands | Repeatable terminal operations, diagnostics, and scripts |

## Run the command

The recommended installer adds a stable `agenvyl` command to your user `PATH`.
Open a new terminal after installation so it sees the updated `PATH`, then run:

```bash
agenvyl
```

In an interactive terminal this opens the terminal control center. You can
request it explicitly with:

```bash
agenvyl tui
```

When input or output is redirected, running `agenvyl` without a command runs
`agenvyl status` instead. This prevents an automation or monitoring process
from trying to open an interactive screen.

If a manual archive installation has not added the stable command, run the
unified launcher from the extracted directory:

| Platform | Example |
| --- | --- |
| Windows | `.\Agenvyl.cmd status` |
| Linux | `./Agenvyl.sh status` |
| macOS | `./Agenvyl.command status` |

The archive also contains dedicated Start, Stop, Status, and Uninstall
launchers. Those launchers are convenient shortcuts; the unified launcher and
stable `agenvyl` command accept every CLI subcommand.

## Get help and version information

```bash
agenvyl --help
agenvyl help logs
agenvyl restore --help
agenvyl --version
```

`agenvyl help <command>` and `agenvyl <command> --help` show the same
command-specific reference.

## Use the terminal control center

The control center shows whether Agenvyl is installed and whether the local
runtime is running, stopped, or needs attention. Menu entries that cannot be
used in the current state are dimmed.

### Navigation

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move between menu entries |
| `Enter` | Run the selected action |
| `D` | Show or hide technical details |
| `Q` or `Esc` | Leave the current screen or exit |

Connector, language, uninstall, and recovery screens show their additional
keys at the bottom of the terminal.

### Menu entries

The exact menu depends on installation and runtime state.

| Entry | What it does | When available | Direct CLI equivalent |
| --- | --- | --- | --- |
| Set up and launch | Initializes the portable runtime, starts it, and opens browser setup | Before initialization | `agenvyl init`, then `agenvyl setup` |
| Repair and restart | Reinitializes an installation that needs attention, starts it, and opens setup | Failed or stale runtime | `agenvyl repair`, then `agenvyl start` |
| Start | Starts the runtime and opens the Web UI | Installed and stopped | `agenvyl start` starts without opening a browser |
| Open Web UI | Opens the running app in the default browser | Running | Open <http://127.0.0.1:8791> |
| Stop | Stops Core, Connector, and managed PostgreSQL | Running or needs attention | `agenvyl stop` |
| Configure connectors | Detects and enables installed agent tools | Running | `agenvyl setup` is the safe CLI fallback |
| Diagnostics | Runs installation, port, and component checks | Always | `agenvyl doctor` |
| Logs | Shows the latest 25 Supervisor log lines in technical details | Installed | `agenvyl logs supervisor --lines 25` |
| Backup | Creates a timestamped database dump and shows its path | Running | `agenvyl backup` |
| Restore | Restores the most recent `.dump` in the Agenvyl backups directory | Installed and stopped | `agenvyl restore <file>` |
| Language | Changes the control-center language | Always | No locale-only command; `agenvyl repair --locale <ru|en>` persists it during repair |
| Uninstall | Removes the app with a choice to preserve or delete personal data | Installed | `agenvyl uninstall` |
| Exit | Closes the control center without stopping Agenvyl | Always | Not applicable |

> [!CAUTION]
> The current **Restore** menu entry immediately selects the lexically latest
> `.dump` filename from the Agenvyl backups directory. Use the direct
> `agenvyl restore <file>` command when you need to choose a specific dump.
> Database restore replaces the current database and requires Agenvyl to be
> stopped.

Closing the control center does not stop the runtime. Use **Stop** or
`agenvyl stop` when you want to stop the local services.

## Command reference

### Start, stop, and inspect the runtime

```bash
agenvyl start
agenvyl status
agenvyl stop
```

`agenvyl start` starts managed PostgreSQL, Connector, and Core. Unlike the TUI
**Start** entry and platform Start launcher, it does not open a browser. Visit
<http://127.0.0.1:8791> or run `agenvyl` and choose **Open Web UI**.

`agenvyl status` returns exit code `0` while the runtime is running and `3`
when it is stopped or has stale state.

### Run diagnostics

```bash
agenvyl doctor
agenvyl doctor --json
```

Diagnostics check Supervisor settings, bundled executables, configured ports,
and whether an active Agenvyl runtime owns those ports. The command returns exit
code `0` when every check passes and `2` when at least one check fails.

### Read logs

```bash
agenvyl logs
agenvyl logs connector
agenvyl logs core --lines 200
agenvyl logs postgresql --lines 500
```

The component defaults to `supervisor`. Valid components are `supervisor`,
`postgresql`, `connector`, and `core`. `--lines` accepts a value from 1 through
10,000 and defaults to 100. Log output is plain text.

Logs do not intentionally contain prompts or model responses, but they can
contain local paths and process diagnostics. Inspect them before sharing.

### Detect and configure connectors

```bash
agenvyl setup
agenvyl setup --all
agenvyl setup --all --no-open
```

`setup` starts the runtime, detects supported agent tools, selects safe
connectors during first setup, and opens the relevant Web UI page. In an
interactive terminal it asks before enabling all safe detected connectors.
`--all` accepts that safe selection without prompting, and `--no-open` keeps
the browser closed.

Safety-sensitive connectors that require an explicit confirmation are not
silently enabled by `--all`. Configure them in the control center and read the
corresponding [harness guide](../harnesses/README.md).

### Create a database backup

```bash
agenvyl backup
agenvyl backup /absolute/path/to/agenvyl-backup.dump
```

Without a destination, the command creates a timestamped PostgreSQL dump in the
Agenvyl `backups/` directory. Managed Agenvyl must be running while the dump is
created.

A database dump does not contain Workspace files, configuration, or secrets.
Follow [Data and backups](data-and-backups.md) to create a complete backup.

### Restore a database backup

```bash
agenvyl stop
agenvyl restore /absolute/path/to/agenvyl-backup.dump
agenvyl start
```

Restore replaces the managed Agenvyl database. It refuses to run while the
runtime is active and is unavailable when Agenvyl uses an external
`AGENVYL_DATABASE_URL`. Restore the matching Workspace tree separately as
described in [Data and backups](data-and-backups.md).

### Initialize or repair command integration

The installer normally runs initialization for you. Use these commands for a
manual portable installation or recovery:

```bash
agenvyl init --locale en --shortcuts recommended --path user
agenvyl repair --locale en --shortcuts recommended --path user
```

Options:

| Option | Values | Meaning |
| --- | --- | --- |
| `--locale` | `ru`, `en` | Control-center language |
| `--shortcuts` | `none`, `recommended`, `all` | Platform shortcuts to create or repair |
| `--path` | `none`, `user` | Whether to install or repair the stable user command |

`init` defaults to `--path none`; `repair` defaults to `--path user`. Both
preserve personal Agenvyl data. A repair can archive damaged Supervisor
settings before recreating them.

### Uninstall

Remove the application while preserving rooms, workspaces, logs, backups, and
configuration:

```bash
agenvyl uninstall
```

Permanently remove both the application and Agenvyl personal data:

```bash
agenvyl uninstall --purge --yes
```

The purge operation cannot be undone without an external backup. See
[Update and uninstall](update-and-uninstall.md) for the complete removal and
reinstallation behavior.

## Structured output and exit codes

Commands that advertise `--json` in their help print structured output:

```bash
agenvyl status --json
agenvyl doctor --json
agenvyl backup --json
```

`logs` always prints plain text. `setup` can print detection and prompt output,
so do not treat it as a JSON-only automation interface.

| Exit code | Meaning |
| --- | --- |
| `0` | Command completed successfully |
| `1` | Invalid command, invalid option value, or operation failure |
| `2` | `doctor` completed and one or more checks failed |
| `3` | `status` found that Agenvyl was not running |

For a first diagnostic pass, run:

```bash
agenvyl status
agenvyl doctor
agenvyl logs supervisor --lines 100
```

Continue with [Troubleshooting](troubleshooting.md) when a check fails or a
component does not start.
