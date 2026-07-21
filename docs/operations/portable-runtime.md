# Portable host runtime

> The portable supervisor and PostgreSQL payload are validated together on
> Linux x64/arm64, macOS x64/arm64, and Windows x64. The release assembly that
> combines both artifacts is a separate packaging milestone; the existing
> production archive below remains Linux-only until that assembly lands.

## Portable supervisor contract

The same Node-based CLI owns the personal runtime on every supported target;
it does not require PM2, systemd, launchd, or a Windows service:

```bash
agenvyl doctor
agenvyl start
agenvyl status
agenvyl logs supervisor --lines 100
agenvyl backup
agenvyl stop
agenvyl restore /absolute/path/to/agenvyl-backup.dump
```

`start` is idempotent. On first run it creates user-only configuration, state,
log, workspace, backup, and PostgreSQL directories, generates secrets with
user-only permissions, initializes the personal database cluster, and starts
PostgreSQL → Connector → Core. `stop` reverses that order and escalates after a
bounded grace period. A singleton lock plus PID and port checks diagnose stale
process state and conflicts; `doctor` reports the exact failing boundary.

Personal data is stored in the platform application-data location:

- Linux: `${XDG_DATA_HOME:-$HOME/.local/share}/agenvyl`
- macOS: `$HOME/Library/Application Support/Agenvyl`
- Windows: `%LOCALAPPDATA%\\Agenvyl`

Setting `AGENVYL_DATABASE_URL` explicitly switches to server/development mode:
the supervisor checks and uses that database but never initializes, stops, or
restores it. Existing Compose/dev-stand clusters are never discovered or
claimed automatically. Moving data into the personal cluster requires an
explicit dump and `agenvyl restore` while the stack is stopped.

The five-target lifecycle probe is:

```bash
npm run build:contracts
node scripts/verify-supervisor-lifecycle.mjs <postgres-runtime-artifact.tar.gz>
```

The legacy production topology runs Core/Web UI and Connector directly on the
Linux host. Docker runs only `postgres:17-alpine`; its published port is bound to
`127.0.0.1` and data remains in the `postgres-data` named volume.

## Build release bundles

```bash
npm ci
npm run bundle
```

This creates Linux x64 and arm64 archives plus SHA-256 sidecars under
`artifacts/`. Each archive contains compiled Core, Web UI and Connector code,
production npm dependencies, launchers, user-systemd units, and Node 22.23.1
for the target architecture. The build verifies the downloaded Node archive
against its pinned official checksum.

## Manual runtime layout

This section describes the existing Linux server bundle and remains available
as the Compose/server path.

Extract the matching archive as
`${XDG_DATA_HOME:-$HOME/.local/share}/agenvyl/current`. Copy
`share/agenvyl/.env.example` to
`${XDG_CONFIG_HOME:-$HOME/.config}/agenvyl/agenvyl.env`, and copy
`share/agenvyl/connector.example.yaml` to `connector.yaml` in the same config
directory. Replace both secrets and keep the database password identical in
`POSTGRES_PASSWORD` and `AGENVYL_DATABASE_URL`.

```bash
mkdir -p "${XDG_DATA_HOME:-$HOME/.local/share}/agenvyl/workspaces"
```

Start PostgreSQL from the extracted runtime:

```bash
docker compose --env-file "$HOME/.config/agenvyl/agenvyl.env" \
  -f "$HOME/.local/share/agenvyl/current/share/agenvyl/compose.yaml" up -d --wait
```

Install and start the user units:

```bash
mkdir -p "$HOME/.config/systemd/user"
cp "$HOME/.local/share/agenvyl/current/systemd/"*.service "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now agenvyl-connector.service agenvyl-core.service
```

Both processes use the same host workspace root:
`${XDG_DATA_HOME:-$HOME/.local/share}/agenvyl/workspaces`. An explicit absolute
`AGENVYL_WORKSPACE_ROOT` overrides it for both processes. There is no container
path mapping.

## Health and recovery

```bash
"$HOME/.local/share/agenvyl/current/bin/agenvyl-health" all
systemctl --user status agenvyl-connector.service agenvyl-core.service
docker compose -f "$HOME/.local/share/agenvyl/current/share/agenvyl/compose.yaml" ps
```

The systemd units restart failed host processes. PostgreSQL uses
`restart: unless-stopped`, and its named volume survives container replacement.
Run `npm run verify:bundle` in a source checkout to exercise the unpacked x64
bundle through Core → Connector → a fake Antigravity-compatible harness,
including forced process restarts, database restart/persistence, and direct
workspace mutation without using the system Node runtime for Agenvyl.
