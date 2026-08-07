# Agenvyl next release (unreleased)

This draft records changes on `main` after v0.6.0. The release version, final
platform statement, and install commands should be added when the release is
cut.

## Headline: captured app builds

- Agent runs can now retain static app output as an immutable build tied to the
  exact response and result snapshot.
- Responses expose **Open this build** when `dist/index.html`,
  `build/index.html`, `out/index.html`, or a supported plain-static entry point
  is captured.
- The Workspace has separate **App** and **Files** views, a build-history
  selector, current and historical states, agent/time/run/publication metadata,
  and detection of byte-identical consecutive builds.
- A preview is marked current only while its conflict-free published source
  still matches the room. Later source changes produce an explicit outdated
  gate instead of silently showing a stale app.
- Generated output, dependencies, caches, test artifacts, secrets, and captured
  `.gitignore` matches stay out of normal source publication and response file
  lists, while remaining available inside the immutable build snapshot.
- Static assets are served from the selected run snapshot on a separate preview
  origin with scoped paths, sandboxed framing, CSP, immutable caching, and
  content ETags.

See the [user guide](../user-guide/app-builds.md) and
[architecture reference](../architecture/app-builds.md).

## Run control and recovery

- Active Codex runs can accept a redirect: Agenvyl interrupts the current turn
  and continues in the same thread, run, and workspace with new guidance.
  Earlier filesystem and external side effects are not rolled back.
- Redirect state is durable across same-Connector-epoch Core recovery, while
  Stop takes precedence and Connector restart remains fail-closed.
- Workspace finalization can resume abandoned captures and publication after a
  restart. Complete snapshots from failed or cancelled runs remain available
  for inspection and can be applied explicitly when allowed.
- Workspace worktree cleanup now has durable retry and quarantine behavior;
  optional warm slots and stat-cache modes reduce repeated materialization and
  hashing while retaining manifest verification gates.

## Fixes and refinements

- Terminal runs present finalization and captured-file status more accurately.
- OpenCode write access remains anchored to the managed Agenvyl workspace when
  external directories are allowed.
- The Windows portable bundle resolves the npm launcher correctly.
- Supervisor stop, restart, and cleanup coordination avoids stale state writes
  and process-lifecycle races.
- Antigravity/AGY bounds inline prompts to the Windows command-line limit and
  falls back safely for larger context.
- Workspace App/Files navigation now clears stale file selection while
  preserving an explicitly selected historical build.

## Upgrade notes

Database migrations run automatically at Core startup. The new artifact
visibility migration classifies existing generated, cache, and secret-like run
artifacts as hidden. Back up PostgreSQL and the workspace root as one recovery
point before upgrading a persistent installation.

Build previews execute captured frontend code. They are isolated from the main
UI origin but may make network requests under the preview policy; inspect
untrusted generated output before opening it.

