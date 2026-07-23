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
