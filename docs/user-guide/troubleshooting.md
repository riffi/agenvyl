# Troubleshooting

Start with the control center or these safe diagnostics:

```bash
agenvyl status
agenvyl doctor
agenvyl logs supervisor --lines 100
```

Logs do not intentionally include prompts or responses, but inspect them before
sharing because local paths and process diagnostics can still be sensitive.

## The Web UI does not open

1. Open <http://127.0.0.1:8791> manually.
2. Check the stack:

   ```bash
   agenvyl status
   agenvyl doctor
   ```

3. If Core is not ready, inspect:

   ```bash
   agenvyl logs core --lines 200
   agenvyl logs connector --lines 200
   ```

4. Stop and start the runtime:

   ```bash
   agenvyl stop
   agenvyl start
   ```

## A Workspace preview looks wrong or is unavailable

Open the file in Workspace and check the selected version first. An attachment
or agent artifact intentionally opens the exact saved version from that
message, which may be older than the file currently published in the room.

For HTML, Markdown, or SVG, switch between **Rendered** and **Source**. If text
contains incorrect characters, open Source and change **Encoding** from Auto to
the expected UTF-8, UTF-16, Windows-1251/1252, or KOI8-R value. This changes
only the display, not the saved file.

Source highlighting is disabled above 1 MiB, and inline source preview is
disabled above 5 MiB. Unsupported binary content and larger source files remain
available through **Download**. These preview limits are separate from the
default 50 MiB workspace file limit.

Use **Refresh workspace** if an external program changed files while the window
was open. See [Workspace and file previews](workspace.md) for the complete
format and version behavior.

## Agent file changes are missing from the current Workspace

Check the status shown with the agent response:

- **Changes applied to room workspace** means the captured changes were
  published.
- **Partially published** means non-conflicting changes were applied but one or
  more paths need a decision. Select **Review conflicts**, choose Keep current,
  Accept agent, or Delete path for every conflict, and apply the resolutions.
- **Snapshot saved · Room workspace unchanged** means Agenvyl preserved the
  captured result but did not publish it, commonly because capture was
  incomplete.

Response artifacts remain available for preview and download even when they
are not the current Workspace versions. Parallel agents start from the same
published state but do not see one another's unfinished file changes.

## An installed harness is not detected

1. Open the control center and choose **Configure connectors**, or run:

   ```bash
   agenvyl setup
   ```

2. Open a new terminal after installing a CLI so the updated `PATH` is visible.
3. Run the tool's own version and authentication checks from its
   [harness guide](../harnesses/README.md).
4. Start Agenvyl from the same user account and environment in which the tool
   works.
5. Inspect Connector logs:

   ```bash
   agenvyl logs connector --lines 200
   ```

## A harness is connected but shows no models

The harness, not Agenvyl, owns model access.

1. Confirm that the harness is authenticated.
2. Check its catalog using the tool-specific guide.
3. Reopen **Configure connectors** after changing the harness configuration.
4. For Hermes, verify authenticated `GET /v1/models` and review
   [Hermes model routes](../harnesses/hermes.md).
5. Inspect Connector logs without publishing credentials.

## Claude cannot edit files or no approval appears

Agenvyl injects its permission bridge into Claude processes automatically. Do
not run `claude mcp add` and do not add `agenvyl_permissions` to a user or
project `.mcp.json`.

Check the installed CLI and Connector:

```bash
claude --version
claude auth status
agenvyl logs connector --lines 200
```

Claude Code `2.1.217` or newer is required. Confirm that the agent uses **Ask
before edits** when you expect an approval card; **Accept edits** allows normal
file edits without one. Update Claude Code if Connector reports an incompatible
initialization response or an MCP connection failure.

An approval expires when its agent run stops, its MCP client disconnects, or
Connector restarts. Start a new run instead of answering an expired card.
Ordinary Claude terminal sessions should not list
`agenvyl_permissions`; its presence there means it was configured manually and
that persistent entry should be removed.

## A required port is already in use

The personal runtime uses loopback ports `8791` for Core, `4310` for Connector,
and `8793` for PostgreSQL.

Run:

```bash
agenvyl doctor
```

Stop the unrelated process using the reported port, or set an unused
`AGENVYL_PORT`, `AGENVYL_CONNECTOR_PORT`, or `AGENVYL_POSTGRES_PORT` before
starting Agenvyl. Use the same environment on later starts.

## Connector or PostgreSQL is not ready

Check each component:

```bash
agenvyl status
agenvyl logs connector --lines 200
agenvyl logs postgresql --lines 200
agenvyl logs supervisor --lines 200
```

Connector failures commonly mean an invalid `connector.yaml`, an unavailable
harness endpoint, or a workspace path problem. PostgreSQL failures commonly
mean a port conflict, interrupted initialization, filesystem permissions, or
insufficient disk space. Do not delete `postgres/` as a troubleshooting step.

## Agenvyl does not start after an update

1. Do not purge personal data.
2. Run:

   ```bash
   agenvyl doctor
   agenvyl logs supervisor --lines 200
   ```

3. Re-run the same version installer to repair application files.
4. If the stable command is unavailable, run the control center from the
   extracted application directory.
5. Preserve the database dump, configuration, and workspace copy before any
   reinstall or restore.

If the problem remains, report it with the Agenvyl version, operating system,
`doctor` output, and redacted component logs.
