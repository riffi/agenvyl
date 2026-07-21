# Portable runtime

Agenvyl is assembled natively for five targets:

| Target | Archive | Start launcher |
| --- | --- | --- |
| Linux x64 | `agenvyl-0.1.0-linux-x64.tar.xz` | `Start Agenvyl.sh` |
| Linux arm64 | `agenvyl-0.1.0-linux-arm64.tar.xz` | `Start Agenvyl.sh` |
| macOS x64 | `agenvyl-0.1.0-darwin-x64.zip` | `Start Agenvyl.command` |
| macOS arm64 | `agenvyl-0.1.0-darwin-arm64.zip` | `Start Agenvyl.command` |
| Windows x64 | `agenvyl-0.1.0-windows-x64.zip` | `Start Agenvyl.cmd` |

Each archive contains compiled Core/Web UI and Connector code, production npm
dependencies, the shared supervisor CLI, Node 22.23.1, PostgreSQL 17.10, license
metadata, a manifest, and a SHA-256 sidecar. It does not require Docker, system
Node, PM2, systemd, launchd, a Windows service, or a source checkout.

The Technical Preview archives are unsigned. macOS Gatekeeper and Windows
SmartScreen may therefore require an explicit user trust override until release
signing identities are configured.

## Start, status, and stop

Extract the archive to any user-writable directory and run the platform Start
launcher. Paths containing spaces and Unicode are supported. After the stack is
healthy, Start opens `http://127.0.0.1:8791` in the default browser. The launcher
does not open a browser when `AGENVYL_NO_OPEN_BROWSER=1`, which is intended for
automation and CI.

Start, Stop, and Status launchers are thin wrappers around the same CLI:

```bash
bin/agenvyl doctor
bin/agenvyl start
bin/agenvyl setup
bin/agenvyl status
bin/agenvyl logs supervisor --lines 100
bin/agenvyl backup
bin/agenvyl stop
bin/agenvyl restore /absolute/path/to/agenvyl-backup.dump
```

On Windows use `bin\agenvyl.cmd` with the same arguments. `setup` starts the
stack if needed, discovers host harnesses, saves the safe selection, and opens
the browser setup screen. `start` is idempotent.
On first run the supervisor generates user-only secrets, initializes the
personal PostgreSQL cluster, and starts PostgreSQL → Connector → Core. `stop`
uses the reverse order and escalates process-tree termination after a bounded
grace period. A singleton lock plus PID, stale-state, health, and port checks
drive `status` and `doctor` diagnostics.

## Personal data

- Linux: `${XDG_DATA_HOME:-$HOME/.local/share}/agenvyl`
- macOS: `$HOME/Library/Application Support/Agenvyl`
- Windows: `%LOCALAPPDATA%\Agenvyl`

The application directory can be replaced without deleting personal rooms,
workspaces, logs, backups, or the PostgreSQL cluster. Use `agenvyl backup` before
upgrades and `agenvyl restore <file>` only while the stack is stopped.

Setting `AGENVYL_DATABASE_URL` explicitly switches the supervisor to
server/development mode. It checks and uses that database but never initializes,
stops, backs up, or restores it. Existing Compose/dev-stand clusters are never
discovered or claimed automatically; migration into the personal cluster is an
explicit dump and restore operation.

## Native build and verification

Build the PostgreSQL payload and portable archive for the current native target:

```bash
npm ci
npm run postgres:runtime:build
npm run bundle
npm run verify:bundle -- artifacts/portable/<archive>
```

The builder accepts `--platform`, `--arch`, and `--postgres-artifact` for CI but
rejects cross-assembly: the requested target must match the native runner. Node
downloads are checked against pinned official SHA-256 values. PostgreSQL payload
checksums and target manifests are verified, and absolute library symlinks are
normalized to relocatable relative aliases during final assembly.

The archive probe copies and extracts the artifact through paths containing
spaces and Unicode, invokes the real platform Start/Status/Stop launchers, checks
the bundled Node and PostgreSQL versions, waits for the Web UI, and verifies that
all three ports and all recorded processes are released after Stop.

Normal pushes run only the fast `Checks` workflow. Native archive gates are
explicit so routine development does not consume five GitHub-hosted runners:

```bash
# Build one target. This uses its PostgreSQL cache when available.
gh workflow run Portable --ref main -f target=linux-x64

# Build all five targets from PostgreSQL artifacts produced by an earlier run.
gh workflow run Portable --ref main -f target=all \
  -f postgres_artifact_run_id=<postgres-runtime-run-id>
```

Set `rebuild_postgres=true` only when intentionally testing PostgreSQL assembly
inside the portable workflow. Prefer the separate `PostgreSQL Runtime` workflow
when the pinned version, payload contract, or build scripts change. If neither a
matching cache nor `postgres_artifact_run_id` is available, `Portable` fails
instead of silently starting an expensive PostgreSQL build.

Run the complete five-target portable gate before closing a platform-sensitive
milestone and before a release candidate. For ordinary Core or Web UI work,
`npm run check:local` and the automatic `Checks` workflow are sufficient.

## Server and development mode

The repository still supports the Compose/source workflow documented in the
README. Production Compose owns only PostgreSQL; Core and Connector remain host
processes. This server/development path is separate from the personal portable
runtime and is not modified or adopted by the portable launchers.
