# Data and backups

Agenvyl keeps the replaceable application files separate from personal data.
Installing a new version can replace the app without deleting rooms,
workspaces, logs, or the PostgreSQL cluster.

## Default locations

| Platform | Configuration | Personal data |
| --- | --- | --- |
| Linux | `${XDG_CONFIG_HOME:-$HOME/.config}/agenvyl` | `${XDG_DATA_HOME:-$HOME/.local/share}/agenvyl` |
| macOS | `$HOME/Library/Application Support/Agenvyl` | `$HOME/Library/Application Support/Agenvyl` |
| Windows | `%LOCALAPPDATA%\Agenvyl` | `%LOCALAPPDATA%\Agenvyl` |

Linux respects absolute `XDG_CONFIG_HOME` and `XDG_DATA_HOME` overrides. The
portable supervisor also accepts `AGENVYL_HOME` for isolated automation.

Important paths below those roots are:

| Path | Purpose |
| --- | --- |
| `connector.yaml` | Non-secret Connector listen, workspace, and harness selection settings |
| `secrets.json` | Generated Connector token and managed PostgreSQL password |
| `supervisor-settings.json` | Language, shortcuts, and owned command integration |
| `postgres/` | Personal PostgreSQL cluster |
| `workspaces/` | Published room files, hidden immutable versions, and managed run worktrees |
| `logs/` | Supervisor, PostgreSQL, Connector, Core, and restore logs |
| `state/` | Runtime lock, process, and health state; not a backup |
| `backups/` | Database dumps created by `agenvyl backup` |
| `versions/` | Installed portable application versions |

Do not edit `secrets.json`, the PostgreSQL data directory, workspace
`.versions/` directories, reserved `.agenvyl/` directories, or runtime state
by hand. `.versions/` stores immutable file content; `.agenvyl/` contains
application-managed run worktrees and markers. Configuration and backup files
can contain sensitive local information and should not be committed or placed
in a public cloud folder.

## What the backup command includes

```bash
agenvyl backup
```

This creates a PostgreSQL custom-format dump in `backups/`. It contains rooms,
messages, agent versions, run history, workspace metadata, and ordered room
events.

It does **not** copy the room workspace files or configuration directory. A
complete recoverable backup needs:

1. the PostgreSQL dump;
2. the entire `workspaces/` directory, including all hidden application-managed
   content; and
3. the configuration directory if you want to preserve Connector selections
   and local settings.

## Create a consistent backup

1. Wait for all runs, uploads, and workspace changes to finish.
2. Create the database dump while Agenvyl is running:

   ```bash
   agenvyl backup
   ```

3. Stop Agenvyl immediately after the dump:

   ```bash
   agenvyl stop
   ```

4. Copy the new `.dump` file, the complete `workspaces/` directory, and the
   configuration directory to protected storage.
5. Start Agenvyl again:

   ```bash
   agenvyl start
   ```

Avoid editing rooms between steps 2 and 3. Agenvyl does not currently create
one combined database-and-filesystem archive.

## Restore

Restore only into a stopped personal runtime. Restoring replaces the current
Agenvyl database.

1. Keep a copy of the current data before replacing anything.
2. Stop Agenvyl:

   ```bash
   agenvyl stop
   ```

3. Restore the matching `workspaces/` tree to the platform data directory.
4. Restore the database dump:

   ```bash
   agenvyl restore /absolute/path/to/agenvyl-backup.dump
   ```

5. Start Agenvyl and inspect the rooms and workspace:

   ```bash
   agenvyl start
   agenvyl status
   ```

On Windows, move a dump whose path contains non-ASCII characters into the
Agenvyl `backups` directory before restoring if PostgreSQL reports a path
compatibility error.

When `AGENVYL_DATABASE_URL` selects an external database, Agenvyl does not own
its lifecycle, backup, or restore. Use the
[server database procedure](../operations/database.md) instead.
