# Technical Preview release runbook

This runbook publishes the current unsigned Technical Preview. It does not
define stable releases, publisher signing, or an automatic update channel.

Published assets are immutable. Never replace the files of a published
version, even when its smoke test later fails.

## 1. Prepare the release commit

Start from a clean, current `main`:

```bash
git switch main
git pull --ff-only
git status --short
```

Choose a version without the leading `v`:

```bash
VERSION=<next-version>
```

Update that version consistently in:

- the root `package.json`;
- every private workspace `package.json`;
- exact internal `@agenvyl/*` dependency pins; and
- `package-lock.json`.

After editing the manifests, regenerate the lockfile:

```bash
npm install --package-lock-only --ignore-scripts
```

Create `docs/releases/v${VERSION}.md`. Release notes must describe user-visible
changes, supported platforms and harnesses, security/trust boundaries, and the
installation entry point. Permanent guides remain evergreen; exact versions
belong here.

Verify release metadata:

```bash
npm run release:verify
```

## 2. Run local gates

```bash
npm ci
npm run check:full
sh -n packaging/install.sh
```

Commit and push the exact release state to `main`. Do not dispatch packaging
from an uncommitted or private-only commit.

## 3. Prepare PostgreSQL artifacts

Reuse target caches when the pinned PostgreSQL source and build contract have
not changed. If a cache may be missing, dispatch:

```bash
gh workflow run 'PostgreSQL Runtime' --ref main -f target=all
```

Record the successful workflow run ID. Rebuild PostgreSQL inside the release
workflow only when intentionally validating a supply-chain change.

## 4. Create the draft prerelease

Dispatch the release workflow:

```bash
gh workflow run 'Preview Release' --ref main \
  -f postgres_artifact_run_id=<postgres-runtime-run-id>
```

The workflow builds and verifies all five native targets, creates the release
manifest and shell index, validates the POSIX installer, creates the CycloneDX
SBOM, SHA-256 list, and GitHub build-provenance attestations, then creates a
draft prerelease for `v${VERSION}`.

The workflow may update an existing draft only when it belongs to the same
commit. It must fail for a published release or a draft targeting another
commit. Delete an obsolete draft deliberately before rerunning from a different
release commit.

## 5. Inspect the draft

Before publishing, check:

- five correctly named portable archives and their sidecars;
- `install.sh` and `install.ps1`;
- `agenvyl-release.json` and `agenvyl-release.txt`;
- `agenvyl-sbom.cdx.json`;
- `SHA256SUMS` and `TRUST.md`;
- build-provenance attestations;
- release notes for the same version; and
- the target commit.

Download at least one archive and verify its checksum and bundle manifest.
Confirm the draft is marked **prerelease**, not stable.

## 6. Publish and run installer smoke tests

Publish the draft as a prerelease. The Release Smoke workflow must download
public release assets, so it runs only after publication.

```bash
gh workflow run 'Release Smoke' --ref main -f version="$VERSION"
```

The matrix installs and verifies:

- Linux x64;
- Linux arm64;
- macOS Intel;
- macOS Apple silicon; and
- Windows x64.

It checks the real tagged installers, owned command path, start/status/stop
lifecycle, Web UI, and preserving uninstall.

## 7. Close or withdraw the release

When all five smoke jobs pass, leave the release as the published Technical
Preview and record the successful run in the release discussion or checklist.

If any published smoke job fails:

1. do not upload replacement assets to the same tag;
2. edit the title and notes to mark the release withdrawn and explain the
   affected target;
3. diagnose and fix the issue on `main`; and
4. prepare a new patch version through this runbook.

Deleting a release does not recall artifacts already downloaded, so a new
version is still required.

