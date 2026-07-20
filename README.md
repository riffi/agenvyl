# Agenvyl

Agenvyl is a room-first workspace for coordinating multiple coding-agent
harnesses. A single Fastify Core serves the React application, REST API, and
room WebSocket. Agent execution is delegated to a separate host-side Connector:

```text
Browser -> Agenvyl Core -> Agenvyl Connector -> Hermes / OpenCode / Antigravity
```

The Connector runs next to the installed harness CLIs and their credential
stores. Credentials stay out of Core, the browser, YAML configuration, and the
application database.

> Agenvyl is currently a pre-release project. The source-run path is supported;
> a packaged one-command installer is a later roadmap milestone.

## Prerequisites

- Node.js 22 and npm
- Docker with Compose v2
- one supported harness installed and authenticated on the host

The default example enables Hermes. OpenCode and Antigravity instances are
available but disabled until their host runtimes are configured.

## Quick start

1. Install dependencies and create local configuration:

   ```bash
   npm ci
   cp .env.example .env
   cp connector.example.yaml connector.yaml
   mkdir -p data/room-workspaces
   ```

2. Add the absolute workspace root to `connector.yaml`:

   ```yaml
   workspaces:
     roots:
       - /absolute/path/to/agenvyl/data/room-workspaces
   ```

3. Generate one shared token, export the Connector settings, and start it:

   ```bash
   export AGENVYL_CONNECTOR_TOKEN="$(openssl rand -hex 32)"
   export AGENVYL_CONNECTOR_HERMES_URL="http://127.0.0.1:8642"
   npm run dev:connector
   ```

4. In another shell, use the same token in `.env`, set
   `AGENVYL_CONNECTOR_URL=http://host.docker.internal:4310`, then start Core:

   ```bash
   docker compose up -d --build
   curl -fsS http://127.0.0.1:8791/api/v1/health
   ```

Open <http://127.0.0.1:8791>. Persistent PostgreSQL data lives in a named Docker
volume; room files live under the configured host workspace path.

The Connector can also be run from a production build with
`npm run build && npm run start:connector`. Detailed setup for Hermes, OpenCode,
and Antigravity is in [the Connector operations guide](docs/operations/connector.md).

## Local development

```bash
npm ci
docker compose up -d postgres
npm run dev:connector  # host-side process
npm run dev:server     # Fastify backend
npm run dev            # Vite frontend
```

For a Compose-based watch environment:

```bash
docker compose -f compose.watch.yaml up -d --build
```

## Verification

```bash
npm test
npm run typecheck
npm run lint:boundaries
npm run build
npm run audit:oss
npm audit --omit=dev --audit-level=high
```

Live harness smoke tests are opt-in because they require local credentials and
running harness services. See the operations guide for the corresponding
commands and environment contracts.

## Architecture and safety boundaries

- Core owns rooms, personas, messages, run snapshots, events, and PostgreSQL.
- Connector owns harness discovery, execution lifecycle, replay, redaction, and
  access to host-side credentials.
- A room workspace is a shared filesystem location, not a security sandbox.
- Connector binds to loopback by default and requires a Bearer token.
- Agenvyl has no telemetry or remote analytics.
- The repository does not include private deployment overlays, credentials,
  internal domains, or machine-specific paths.

Read [OSS operations boundaries](docs/operations/oss-boundaries.md),
[runtime policy](docs/operations/runtime.md), and
[database operations](docs/operations/database.md) before exposing a deployment
outside a trusted machine.

## Contributing and security

Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Report
vulnerabilities using the private process in [SECURITY.md](SECURITY.md), not a
public issue.

## License

Licensed under the [Apache License 2.0](LICENSE).
