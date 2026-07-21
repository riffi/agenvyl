# Unsigned Technical Preview trust guide

Agenvyl `v0.1.0` is an unsigned Technical Preview. The release is intended for a trusted, single-operator workstation and binds PostgreSQL, Connector, and Core to loopback. Do not expose it directly to the public internet or install it on a host where untrusted users can control the enabled coding-agent harnesses.

## Verify a download

Each release contains `SHA256SUMS`, a CycloneDX application SBOM, per-archive checksums, and GitHub build-provenance attestations. Download the artifact and `SHA256SUMS` from the same GitHub Release, then verify before extracting it.

Linux:

```bash
sha256sum --check --ignore-missing SHA256SUMS
```

macOS:

```bash
expected=$(awk '$2 == "agenvyl-0.1.0-darwin-arm64.zip" { print $1 }' SHA256SUMS)
test "$(shasum -a 256 agenvyl-0.1.0-darwin-arm64.zip | awk '{ print $1 }')" = "$expected"
```

Windows PowerShell:

```powershell
$expected = (Select-String 'agenvyl-0.1.0-windows-x64.zip$' SHA256SUMS).Line.Split(' ')[0]
if ((Get-FileHash .\agenvyl-0.1.0-windows-x64.zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Checksum mismatch' }
```

With GitHub CLI installed, verify the build provenance against this repository:

```bash
gh attestation verify agenvyl-0.1.0-linux-x64.tar.xz --repo riffi/agenvyl
```

The one-line installers perform the release-index, file-size, and SHA-256 checks automatically. They do not bypass operating-system trust prompts.

## macOS Gatekeeper

The preview is not notarized and its `.command` launchers may be blocked after download. Verify the checksum and provenance first. Then try to open the launcher once and use **System Settings → Privacy & Security → Open Anyway** for that specific copy if you accept the risk. Do not disable Gatekeeper globally and do not recursively remove quarantine attributes from unrelated files.

## Windows SmartScreen

The preview is not Authenticode-signed and Windows may show a SmartScreen warning. Verify the checksum and provenance first. If the publisher and downloaded filename match the GitHub Release, choose **More info → Run anyway** for that artifact. Do not weaken SmartScreen system-wide.

## Runtime boundary

- Core, Connector, and bundled PostgreSQL listen on `127.0.0.1` by default.
- Connector requires a generated Bearer token; generated Connector and PostgreSQL credentials are stored only in the user config directory.
- Credentials are excluded from configuration YAML, application responses, logs, release assets, and the database contract.
- Harness processes run with the operator's filesystem permissions. Agenvyl workspaces are collaboration directories, not sandboxes.
- Preserving uninstall removes the versioned bundle and Agenvyl-owned command/PATH integration while retaining user data. Full purge requires an explicit confirmation.

Report security issues using [SECURITY.md](../../SECURITY.md).
