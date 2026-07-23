# Development setup

This guide runs the complete Agenvyl stack from a source checkout. It is for
contributors; users of the downloadable app should follow the
[installation guide](../user-guide/installation.md).

## Prerequisites

Install:

- Git;
- Node.js 22 and npm;
- Docker with Docker Compose v2; and
- at least one supported harness if you want to run live agent requests.

Clone the repository and install the locked dependencies:

```bash
git clone https://github.com/riffi/agenvyl.git
cd agenvyl
npm ci
```

Do not place provider keys, OAuth state, or private deployment configuration in
the repository.

## Start the development stack

```bash
npm run dev:all
```

The development runner:

1. creates `data/room-workspaces`;
2. copies `connector.example.yaml` to ignored `connector.yaml` when it is
   missing;
3. starts PostgreSQL through Docker Compose;
4. builds shared TypeScript contracts; and
5. starts Connector, Core, and the Vite frontend in watch mode.

Open the Vite URL printed in the terminal. The frontend proxies API and
WebSocket traffic to Core on `127.0.0.1:8791`. Development PostgreSQL uses host
port `55432` by default so it does not collide with a normal local PostgreSQL
installation.

Press `Ctrl+C` to stop the three watch processes. PostgreSQL deliberately stays
running for the next development session. Stop it with:

```bash
npm run dev:down
```

## Configure a development harness

Edit the ignored `connector.yaml` to enable the harness instances you need.
Keep endpoint credentials and executable overrides in the environment, not in
YAML.

The [harness guides](../harnesses/README.md) describe normal installation and
authentication. Development-only Connector variables are documented in the
[operator reference](../operations/connector.md).

Live harnesses run with your host user permissions against
`data/room-workspaces`. Never point development or smoke tests at an important
personal workspace.

## Run components separately

Use this only when debugging one process:

```bash
docker compose up -d --wait postgres
npm run build:contracts
npm run dev:connector
npm run dev:server
npm run dev
```

When starting components separately, supply the same Connector token,
workspace root, Connector URL, and database URL to the relevant processes. The
combined `dev:all` command handles those values automatically.

## Project map

| Path | Purpose |
| --- | --- |
| `apps/frontend` | React Web UI |
| `apps/backend` | Core HTTP, persistence, orchestration, and realtime services |
| `apps/connector` | Host-side harness gateway and adapters |
| `packages/contracts` | Core API and room-event contracts |
| `packages/connector-contract` | Versioned Core/Connector protocol |
| `packages/runtime-config` | Cross-platform runtime paths |
| `packages/supervisor` | Portable control center and process lifecycle |
| `scripts` | Boundary checks, build, packaging, and release verification |

Read [How Agenvyl works](../architecture/overview.md) before changing component
boundaries. Core must not read harness credentials or call a harness directly.

Next, see [Testing](testing.md) and [Building](building.md).

