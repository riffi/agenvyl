# Portable host runtime

> The implemented production bundle is currently Linux-only and still uses
> PostgreSQL Compose. The cross-platform bundled PostgreSQL supply-chain gate
> is documented in [the runtime spike](postgres-runtime-spike.md); that spike
> does not change this baseline yet.

The production topology runs Core/Web UI and Connector directly on the Linux
host. Docker runs only `postgres:17-alpine`; its published port is bound to
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
