# Deployment boundaries

This repository is the portable Agenvyl product source. It intentionally does
not contain any operator's deployment overlay, reverse-proxy configuration,
service units, DNS names, certificates, credentials, database dumps, or absolute
host paths.

## What the repository supports today

- building Core and the host-side Connector from source;
- running PostgreSQL through Docker Compose and Core as a host process;
- running Connector beside locally installed harnesses;
- building five native portable archives and a versioned installer release;
- local development through Vite and `tsx watch`;
- deterministic unit, integration, boundary, build, dependency, license,
  secret-pattern, internal-reference, and branding checks.

The current release boundary includes an unsigned single-user portable runtime,
versioned release manifest, checksum-validating installers, and safe repeated
install/upgrade. A container image, service deployment, automatic updater, and
signed distribution are future milestones and must not be inferred from the
development Compose files.

## Trust model

Core is vendor-neutral and receives no harness credentials. Connector is the
only component allowed to read harness URLs, tokens, CLI locations, and local
credential stores. It binds to `127.0.0.1` by default and requires a shared
Bearer token. Put an authenticated TLS reverse proxy in front of Core before any
non-loopback exposure.

Connector and enabled harnesses execute with the permissions of their host
user. Workspace canonicalization prevents room-relative path escape at the
Connector API boundary, but it does not sandbox the harness process. Use an OS
account, container, VM, or another isolation boundary appropriate for the code
and users you do not trust.

## Persistent state

- PostgreSQL contains application records and room event history.
- The configured workspace root contains live room files and immutable file
  versions.
- Harness credentials remain in their native host-side stores.

Back up both PostgreSQL and the workspace root before upgrades. Never bake `.env`,
`connector.yaml`, credential stores, or workspace data into an image or commit.

## Private deployments

Private environments should consume this repository through a separate overlay
or deployment repository. Such an overlay may select profiles, domains,
supervisors, and secret injection, but product code must stay runnable without
it. Deployment-specific names must not leak back into tracked product files.
