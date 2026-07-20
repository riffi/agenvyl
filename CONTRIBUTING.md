# Contributing to Agenvyl

Thank you for helping improve Agenvyl.

## Development setup

Use Node.js 22, npm, Docker, and Docker Compose v2. Then run:

```bash
npm ci
docker compose up -d postgres
npm test
npm run typecheck
npm run lint:boundaries
npm run build
npm run audit:oss
```

The integration suite creates isolated PostgreSQL test databases. The database
role must be allowed to create and drop databases. Live harness smoke tests are
separate and must never use shared production credentials or workspaces.

## Pull requests

- Keep changes focused and explain the user-visible outcome.
- Add or update tests for behavior changes.
- Preserve the Core/Connector boundary: Core must not read harness credentials
  or call harnesses directly.
- Keep private deployment overlays, internal URLs, absolute personal paths, and
  secrets out of the repository.
- Update operations or architecture documentation when a contract changes.
- Run all verification commands above before requesting review.

Contributions are submitted under the repository's Apache-2.0 license. No
Contributor License Agreement is currently required.

## Project structure

- `apps/backend`: Core HTTP, persistence, and realtime services
- `apps/frontend`: React user interface
- `apps/connector`: host-side harness gateway
- `packages/contracts`: Core API contracts
- `packages/connector-contract`: Connector protocol contracts
- `docs/operations`: operator-facing runtime guidance
- `docs/architecture`: design records and migration notes

See [SECURITY.md](SECURITY.md) for private vulnerability reporting.
