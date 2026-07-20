# Security policy

## Supported versions

Agenvyl is pre-release software. Security fixes are made on the latest commit of
`main`; older commits and private forks are not maintained as separate release
lines.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting or open a private security
advisory for `riffi/agenvyl`. Do not disclose a vulnerability, credential, host
path, or reproduction containing private data in a public issue.

Include the affected commit, impact, reproduction steps, and any proposed
mitigation. You should receive an acknowledgement within seven days. No formal
bug-bounty program or guaranteed response SLA is currently offered.

## Deployment assumptions

Agenvyl currently targets a trusted, single-operator host. The Connector can
execute coding-agent harnesses with the operator's filesystem access and must
remain on a trusted network boundary. Loopback binding and a strong Bearer token
are defaults, not substitutes for host isolation.

Room workspaces are collaboration directories, not sandboxes. Do not expose the
application directly to untrusted users or the public internet without an
authentication and authorization layer, TLS, network controls, backups, and an
explicit review of the enabled harness permissions.
