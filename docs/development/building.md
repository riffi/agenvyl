# Building Agenvyl

## Build the application

From a clean checkout:

```bash
npm ci
npm run build
```

This builds shared packages, TypeScript applications, the React frontend,
server output, and copied database migrations. It does not create a portable
installer archive.

## Portable targets

Agenvyl produces five native packages:

| Target | Archive |
| --- | --- |
| Linux x64 | `agenvyl-<version>-linux-x64.tar.xz` |
| Linux arm64 | `agenvyl-<version>-linux-arm64.tar.xz` |
| macOS Intel | `agenvyl-<version>-darwin-x64.zip` |
| macOS Apple silicon | `agenvyl-<version>-darwin-arm64.zip` |
| Windows x64 | `agenvyl-<version>-windows-x64.zip` |

Each package contains the built app, production dependencies, Node.js, the
target-native PostgreSQL runtime, platform launchers, license metadata, an
application SBOM, a manifest, and a SHA-256 sidecar.

The builder rejects cross-assembly. Build Linux on the matching Linux
architecture, macOS on the matching macOS architecture, and Windows on Windows.
Use the GitHub **Portable** workflow when all five targets are required.

## Build the native PostgreSQL payload

The pinned source version and checksum live in
`packaging/postgres-runtime.json`. See the
[supply-chain architecture record](../architecture/postgres-runtime.md).

On Linux, install a C toolchain, Bison, and Flex. On macOS, install Xcode command
line tools, Bison, and Flex. Windows requires an MSVC developer environment,
WinFlexBison, Python, Meson, and Ninja.

Build and verify the current native payload:

```bash
npm run postgres:runtime:build
npm run postgres:runtime:verify
```

The output is written below `artifacts/postgres-runtime/`.

## Build and verify a portable archive

```bash
npm run bundle
```

If the payload is not at the default location, pass it explicitly:

```bash
node scripts/build-runtime-bundle.mjs \
  --postgres-artifact artifacts/postgres-runtime/<postgres-archive>.tar.gz
```

Verify the generated archive:

```bash
npm run verify:bundle -- artifacts/portable/<agenvyl-archive>
```

Verification extracts through paths containing spaces and Unicode, checks the
bundled Node.js and PostgreSQL versions, starts the real stack, probes the Web
UI, stops it, confirms all ports and processes are released, and checks that
loopback services and generated secrets stay within their intended boundary.

## Test the Windows installer locally

On Windows:

```powershell
npm run bundle
npm run install:local:windows
```

This creates a temporary release index for the new ZIP and invokes the
production `install.ps1` flow unchanged. By default it modifies the normal user
command path and shortcuts and starts setup.

Use an isolated unattended probe when you do not want those changes:

```powershell
npm run install:local:windows -- `
  -NoPath `
  -NoLaunch `
  -InstallRoot C:\temp\agenvyl-versions
```

Run installer contract tests separately:

```bash
node --test scripts/installer-contract.test.js
```

Platform integration tests are in `scripts/installer-posix.integration.test.js`
and `scripts/installer-windows.integration.test.js`.

## Build through GitHub Actions

Build one native target:

```bash
gh workflow run Portable --ref main -f target=linux-x64
```

Build PostgreSQL payloads for all targets:

```bash
gh workflow run 'PostgreSQL Runtime' --ref main -f target=all
```

Build all portable targets using payloads from that run:

```bash
gh workflow run Portable --ref main \
  -f target=all \
  -f postgres_artifact_run_id=<postgres-runtime-run-id>
```

Set `rebuild_postgres=true` only when intentionally rebuilding the pinned
database payload. On a cache miss, Portable requires either an explicit
PostgreSQL artifact run ID or that rebuild flag; it never starts an expensive
database build silently.

Release assembly is a maintainer workflow. Follow the
[release runbook](../releases/README.md).

