# Agenvyl documentation

Choose the route that matches what you are trying to do.

## Install and use Agenvyl

Start with the [installation and first-run guide](user-guide/installation.md).
It covers the guided installer, manual archive installation, the control
center, and your first room.

Continue with:

- [Workspace and file previews](user-guide/workspace.md)
- [Data and backups](user-guide/data-and-backups.md)
- [Updates and uninstall](user-guide/update-and-uninstall.md)
- [Troubleshooting](user-guide/troubleshooting.md)
- [Trust and security](user-guide/trust-and-security.md)

## Connect an agent tool

Read the [harness overview](harnesses/README.md), then follow the guide for your
tool:

- [Codex CLI](harnesses/codex.md)
- [Claude Code CLI](harnesses/claude.md)
- [OpenCode](harnesses/opencode.md)
- [Antigravity / AGY](harnesses/antigravity.md)
- [Hermes](harnesses/hermes.md)

## Understand the architecture

Read [How Agenvyl works](architecture/overview.md) for the product model,
component boundaries, execution flow, persistence, and security model.

The [bundled PostgreSQL supply chain](architecture/postgres-runtime.md) records
how the native database payload is built and verified.

## Operate a server or custom deployment

The operator references cover:

- [Runtime behavior and recovery](operations/runtime.md)
- [Connector configuration and protocol](operations/connector.md)
- [PostgreSQL migrations and restore](operations/database.md)
- [Supported deployment boundaries](operations/deployment-boundaries.md)

These pages assume familiarity with processes, environment variables, and
PostgreSQL. The downloadable personal runtime is documented in the
[User Guide](user-guide/installation.md).

## Develop Agenvyl

Use the [development setup](development/README.md) to run the repository from a
clean checkout. Then see [testing](development/testing.md) and
[building native packages](development/building.md).

Contribution policy remains in the repository
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Prepare a release

Maintainers should follow the
[Prerelease and stable release runbook](releases/README.md). Version-specific notes
are archived beside it, beginning with [v0.1.0](releases/v0.1.0.md).
