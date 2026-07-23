# Contributing to Agenvyl

Thank you for helping improve Agenvyl.

## Before you start

Follow the [development setup](docs/development/README.md) for prerequisites,
the full local stack, repository structure, and harness configuration.

Normal verification is documented in [Testing](docs/development/testing.md).
Run at least:

```bash
npm ci
npm run check:local
npm run build
```

Use [Building](docs/development/building.md) for native portable packages and
the Windows installer. Release publication is a maintainer workflow documented
in the [Technical Preview runbook](docs/releases/README.md).

## Pull requests

- Keep changes focused and explain the user-visible outcome.
- Add or update tests for behavior changes.
- Preserve the Core/Connector boundary: Core must not read harness credentials
  or call harnesses directly.
- Keep private deployment overlays, internal URLs, absolute personal paths,
  credentials, and workspace data out of the repository.
- Update user, operator, or architecture documentation when a contract changes.
- Run the relevant local and platform-specific gates before requesting review.

Contributions are submitted under the repository's Apache-2.0 license. No
Contributor License Agreement is currently required.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
