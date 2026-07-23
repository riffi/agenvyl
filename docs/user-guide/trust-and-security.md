# Trust and security

Agenvyl Technical Preview releases are currently unsigned. Install them only on
a trusted, single-user computer and verify downloads before overriding
SmartScreen or Gatekeeper.

## Verify a release

Set the release version without the leading `v`:

```bash
VERSION=<release-version>
```

Download `SHA256SUMS` from the same GitHub release as the archive.

On Linux:

```bash
sha256sum --check SHA256SUMS --ignore-missing
```

On macOS, compare the expected entry with:

```bash
shasum -a 256 "agenvyl-${VERSION}-darwin-arm64.zip"
```

On Windows:

```powershell
$version = '<release-version>'
Get-FileHash ".\agenvyl-$version-windows-x64.zip" -Algorithm SHA256
```

Compare the complete lowercase digest with `SHA256SUMS`. Do not install when
the filename, byte size, or digest differs.

When GitHub CLI attestation verification is available:

```bash
gh attestation verify "agenvyl-${VERSION}-linux-x64.tar.xz" --repo riffi/agenvyl
```

Verification proves that the artifact matches the published release metadata
and GitHub build provenance. It does not make an unsigned executable trusted by
the operating system.

## macOS Gatekeeper

Gatekeeper may quarantine the unsigned archive or launcher. Verify the checksum
and provenance first, then use Finder's **Open** action or the system Privacy &
Security panel to approve that specific downloaded copy. Do not disable
Gatekeeper globally.

## Windows SmartScreen

SmartScreen may show **Windows protected your PC**. Verify the archive first,
then use **More info → Run anyway** only for the verified Agenvyl launcher. Do
not disable SmartScreen globally.

## Runtime boundary

- Core, Connector, and bundled PostgreSQL bind to loopback by default.
- Connector requires a generated token and keeps harness credentials out of
  Core.
- Agenvyl adds no telemetry or remote analytics.
- Installed harnesses retain their own network, telemetry, plugins, hooks, MCP
  servers, and provider behavior.
- Harness processes run with the permissions of your operating-system user.
- A room workspace is a shared working directory, **not a sandbox**.

Do not enable an agent tool or permission profile that you would not trust with
the selected files. Agenvyl has no public multi-user authorization layer. Put a
separate authenticated TLS boundary in front of Core before any non-loopback
exposure.

Report vulnerabilities using [SECURITY.md](../../SECURITY.md).

