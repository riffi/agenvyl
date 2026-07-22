# Build and test the Windows installer locally

## Quick start

From the repository root in Windows PowerShell, run:

```powershell
npm run bundle
npm run install:local:windows
```

The first command builds the Windows bundle. The second installs that bundle
through the same `packaging/install.ps1` flow used by a published release. No
GitHub build or release is required.

If `npm run dev:all` is running, stop it before the second command because it
normally occupies port `8791`. ZIP creation is quiet and may take several
minutes; wait for `npm run bundle` to return to the prompt.

After installation, open a new terminal and run `agenvyl`.

## Technical details

### Prerequisites

- Node.js 22 or newer
- `artifacts/postgres-runtime/agenvyl-postgres-17.10-windows-x64.tar.gz`
  and its `.sha256` sidecar
- ports `8791`, `4310`, and `8793` free before testing application startup

Run `npm ci` once after cloning the repository or changing dependencies.

### Verify the bundle separately

```powershell
$version = (Get-Content package.json | ConvertFrom-Json).version
npm run verify:bundle -- "artifacts/portable/agenvyl-$version-windows-x64.zip"
```

Check the installed runtime with:

```powershell
agenvyl status
agenvyl doctor
```

### Installation options and troubleshooting

If startup failed only because a port was occupied, stop the conflicting
process and retry without reinstalling:

```powershell
agenvyl setup --all
```

To skip PATH changes and application startup, and install the bundle under a
custom application root, use:

```powershell
npm run install:local:windows -- -NoPath -NoLaunch -InstallRoot C:\temp\agenvyl-versions
```

This still exercises the production `init` flow, including recommended
shortcuts and the normal user data location.

The local adapter calculates the ZIP size and SHA-256, creates a temporary
release index, and invokes `packaging/install.ps1` unchanged.

### Automated installer tests

Run the fast fixture-based tests after changing either installer script or the
local adapter:

```powershell
npm exec vitest run scripts/installer-contract.test.js scripts/installer-windows.integration.test.js
```

These tests cover checksum validation, archive extraction, `init`, optional
`setup`, and the local ZIP adapter without modifying the real installation.
