# Testing

## Normal local gate

Run before opening a pull request:

```bash
npm run check:local
```

It builds shared contracts, runs deterministic unit and integration tests,
type-checks the workspace, checks frontend/backend import boundaries, and
audits runtime-facing English.

Also verify the production build:

```bash
npm run build
```

The complete repository gate adds the build, OSS baseline audit, and production
dependency audit:

```bash
npm run check:full
```

## Individual checks

```bash
npm test
npm run typecheck
npm run lint:boundaries
npm run audit:english-runtime
npm run audit:oss
npm audit --omit=dev --audit-level=high
```

The database-backed integration suite creates and drops isolated databases.
The configured test PostgreSQL role must be allowed to create databases. Do not
point tests at the personal portable cluster or another shared database.

## Harness fixture suites

These deterministic tests do not need live provider credentials:

```bash
npm run test:e2e:hermes
npm run test:e2e:opencode
npm run test:codex
npm run test:e2e:codex
npm run test:claude
npm run test:e2e:claude
```

They validate Agenvyl's adapter and protocol behavior against controlled
fixtures. Passing a fixture suite does not prove that a newly released upstream
CLI remains compatible.

## Live smoke tests

Live tests are explicit opt-ins:

```bash
npm run smoke:hermes:live
npm run smoke:opencode:live
npm run smoke:antigravity:live
npm run smoke:codex:live
npm run smoke:claude:live
```

Run them only with:

- a separately authenticated test harness;
- an isolated workspace root;
- an isolated PostgreSQL database;
- the environment variables documented by the harness adapter; and
- credentials that may safely incur test requests.

Never use a shared production workspace or copy credentials into repository
files, test fixtures, logs, or shell transcripts.

## Continuous integration

- **Checks** is the main Linux gate for `main` and pull requests.
- **CI** adds cross-platform type, boundary, Codex, and build coverage.
- **Security** runs the OSS and production dependency audits.
- **Portable** performs target-native packaging and lifecycle verification when
  dispatched.

Platform-sensitive changes should be tested on the affected native target, not
only through a TypeScript build on another operating system.

