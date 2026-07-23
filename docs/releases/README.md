# Release runbook

This runbook covers both GitHub prereleases and stable GitHub releases. Choose
the release type before changing the version or dispatching CI. Product trust
boundaries are independent of this choice: both release types remain unsigned
until publisher signing is implemented.

Published assets are immutable. Never replace the files of a published
version, even when its smoke test later fails.

## 1. Choose the release type and version

Use a prerelease for a release candidate or limited validation. Use a stable
release when the version is ready to become the default recommended download.

| Release type | Version example | GitHub state | Manifest channel |
| --- | --- | --- | --- |
| `prerelease` | `0.3.0-rc.1` | Prerelease, not Latest | `preview` |
| `stable` | `0.3.0` | Regular release and Latest | `stable` |

Set both values explicitly:

```bash
RELEASE_TYPE=prerelease # or stable
VERSION=<next-version>
```

Do not publish a release-candidate version such as `0.3.0-rc.1` as stable.
Prepare a new final version instead.

## 2. Prepare the release commit

Start from a clean, current `main`:

```bash
git switch main
git pull --ff-only
git status --short
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

## 3. Run local gates

```bash
npm ci
npm run check:full
sh -n packaging/install.sh
```

Commit and push the exact release state to `main`. Do not dispatch packaging
from an uncommitted or private-only commit.

## 4. Prepare PostgreSQL artifacts

Reuse target caches when the pinned PostgreSQL source and build contract have
not changed. If a cache may be missing, dispatch:

```bash
gh workflow run 'PostgreSQL Runtime' --ref main -f target=all
```

Record the successful workflow run ID. Rebuild PostgreSQL inside the release
workflow only when intentionally validating a supply-chain change.

## 5. Create the release draft

Dispatch the draft workflow with the chosen release type:

```bash
gh workflow run 'Release Draft' --ref main \
  -f release_type="$RELEASE_TYPE" \
  -f postgres_artifact_run_id=<postgres-runtime-run-id>
```

The workflow builds and verifies all five native targets, creates the release
manifest and shell index, validates the POSIX installer, creates the CycloneDX
SBOM, SHA-256 list, and GitHub build-provenance attestations, then creates a
draft for `v${VERSION}`. It writes `preview` or `stable` to the release manifest
and sets the draft's GitHub prerelease classification from `RELEASE_TYPE`.

The workflow may update an existing draft only when it belongs to the same
commit and release type. It must fail for a published release, a draft targeting
another commit, or a draft with the other release type. Delete an obsolete draft
deliberately before rerunning with a different commit or classification.

## 6. Inspect the draft

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
Inspect the classification before publication:

```bash
gh release view "v$VERSION" \
  --json isDraft,isPrerelease,targetCommitish,assets
```

`isPrerelease` must be `true` for `RELEASE_TYPE=prerelease` and `false` for
`RELEASE_TYPE=stable`. Stop if it does not match the intended release type.

## 7. Publish with the intended classification

For a prerelease:

```bash
gh release edit "v$VERSION" \
  --draft=false \
  --prerelease \
  --latest=false
```

For a stable release:

```bash
gh release edit "v$VERSION" \
  --draft=false \
  --prerelease=false \
  --latest
```

Immediately verify that the published classification matches the choice:

```bash
gh release view "v$VERSION" --json isDraft,isPrerelease,tagName,url
```

Do not rely on the workflow name, release title, or version number to infer the
GitHub classification; `isPrerelease` is the authoritative check.

## 8. Run installer smoke tests

The Release Smoke workflow downloads public release assets, so it runs only
after publication:

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

## 9. Close or withdraw the release

When all five smoke jobs pass, leave the published classification unchanged and
record the successful run in the release discussion or checklist. A stable
release should be visible as Latest; a prerelease must remain excluded from
Latest.

If any published smoke job fails:

1. do not upload replacement assets to the same tag;
2. edit the title and notes to mark the release withdrawn and explain the
   affected target;
3. diagnose and fix the issue on `main`; and
4. prepare a new patch version through this runbook.

Deleting a release does not recall artifacts already downloaded, so a new
version is still required.
