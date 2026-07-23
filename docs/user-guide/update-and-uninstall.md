# Update and uninstall

## Update Agenvyl

The current Technical Preview has no automatic updater. Running the installer
again installs the selected release, repairs the stable command and shortcuts,
and removes the previous recognized application version after successful
initialization. Personal data remains outside the versioned application
directory.

Before updating:

1. finish active agent runs;
2. create a [complete backup](data-and-backups.md#create-a-consistent-backup);
3. review the target release notes; and
4. stop Agenvyl.

Then run the same installer used for the first installation:

### Windows

```powershell
$version = '<release-version>'
$env:AGENVYL_VERSION = $version
irm "https://github.com/riffi/agenvyl/releases/download/v$version/install.ps1" | iex
```

### Linux and macOS

```bash
VERSION=<release-version>
curl -fsSL "https://github.com/riffi/agenvyl/releases/download/v${VERSION}/install.sh" |
  sh -s -- --version "$VERSION"
```

Pin a specific release with `AGENVYL_VERSION=<version>`, `--version <version>`,
or PowerShell `-Version <version>`. The value does not include the leading `v`.

After the update:

```bash
agenvyl status
agenvyl doctor
```

If initialization of a same-version replacement fails, the installer restores
the previous recognized directory. See
[Troubleshooting](troubleshooting.md#agenvyl-does-not-start-after-an-update)
for recovery checks.

## Remove the app but keep personal data

Use the control center action **Remove application, preserve user data**, a
platform `Uninstall Agenvyl` launcher, or:

```bash
agenvyl uninstall
```

This stops Agenvyl and removes the recognized application directory, owned
command shim, owned shortcuts, and owned Windows User `PATH` entry. Rooms,
workspaces, logs, backups, configuration, and the PostgreSQL cluster remain.

This is the recommended mode before reinstalling or moving to another release.

## Permanently remove the app and all data

Use **Remove application and all user data**, the matching platform launcher,
or:

```bash
agenvyl uninstall --purge --yes
```

This permanently deletes the application and the Agenvyl configuration and
data roots. It cannot be undone unless you have an external database dump and
workspace copy.

The uninstaller refuses to remove an application directory without a
recognized portable manifest. It does not delete external databases or
third-party harness installations and credentials.
