# Agenvyl v0.1.0 Technical Preview

The first public Agenvyl Technical Preview is a local, single-user workspace for coordinating Hermes, OpenCode, and Antigravity coding-agent harnesses in shared rooms.

## Included

- Self-contained native archives for Linux x64/arm64, macOS x64/arm64, and Windows x64.
- Bundled Node.js 22 and PostgreSQL 17.10; Docker and a system Node installation are not required.
- One-line POSIX and PowerShell installers with version pinning, SHA-256 verification, rollback, and a user-level `agenvyl` command.
- TUI lifecycle control, English Web setup/UI, connector discovery, diagnostics, backup/restore, and preserving/full uninstall.
- CycloneDX SBOMs, `SHA256SUMS`, and GitHub build-provenance attestations.

## Preview boundary

This release is unsigned and intended for a trusted single-operator workstation. It has no service/autostart, automatic update, tray application, telemetry, or multi-user authorization layer. Review the [trust guide](https://github.com/riffi/agenvyl/blob/main/docs/operations/preview-trust.md) before installation.

## Install

Linux or macOS:

```bash
curl -fsSL https://github.com/riffi/agenvyl/releases/latest/download/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://github.com/riffi/agenvyl/releases/latest/download/install.ps1 | iex
```
