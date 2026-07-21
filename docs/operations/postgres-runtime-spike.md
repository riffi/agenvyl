# PostgreSQL runtime supply-chain spike

This spike validates the storage prerequisite for the cross-platform portable
runtime. It does not install Agenvyl, replace the existing Compose deployment,
or implement the production supervisor.

## Source of truth

`packaging/postgres-runtime.json` pins PostgreSQL 17.10 to the official source
archive and SHA-256 published by the PostgreSQL project. Builds never resolve a
floating `17` release and do not consume EDB, Homebrew, distro, or third-party
embedded binary archives.

The five native targets are Linux x64/arm64, macOS x64/arm64, and Windows x64.
Linux and macOS use the release archive's Autoconf/Make build. Windows uses the
same source with the supported Meson/MSVC build. Optional integrations are
disabled; the payload is intended for a loopback-only personal cluster.

## Payload contract

Each `agenvyl-postgres-<version>-<target>.tar.gz` contains:

- the server and allowlisted lifecycle/client tools needed by Agenvyl;
- PostgreSQL runtime libraries and share data;
- the upstream PostgreSQL copyright;
- a manifest with source, target, build system, features, and signing status;
- a minimal CycloneDX SBOM.

Artifacts are unsigned during the Technical Preview. The CI signing job is an
explicit optional boundary and does not treat checksums or provenance as an
operating-system publisher signature.

## Native gate

Build and verify the current host target:

```bash
npm run postgres:runtime:build
npm run postgres:runtime:verify -- artifacts/postgres-runtime/<archive>.tar.gz
```

Verification extracts into a path containing spaces and Unicode, then runs
`initdb`, loopback start/readiness, table creation, uncompressed custom
`pg_dump`, database recreation, `pg_restore`, value verification, bounded stop,
PID status, and port-release checks.

CI runs this gate natively on all five GitHub-hosted runner targets. Build or
verification failure on any target blocks completion of the spike.

## Boundaries carried into the supervisor

- Personal portable data uses a new platform-local cluster directory.
- Existing Docker volumes and the private dev stand are never adopted
  automatically; explicit backup/restore is the migration path.
- The future supervisor starts PostgreSQL before Connector and Core, and stops
  components in reverse order.
- Process-tree termination has a graceful deadline followed by forced
  termination; no child process may survive a successful stop.
- External `DATABASE_URL` and Compose remain the server/development mode.
