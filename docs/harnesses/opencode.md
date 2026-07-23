# Connect OpenCode

## Before you start

Install OpenCode from its [official documentation](https://opencode.ai/docs):

```bash
curl -fsSL https://opencode.ai/install | bash
```

An npm installation is also supported upstream:

```bash
npm install --global opencode-ai
```

Start OpenCode once and configure the providers you want to use. Check stored
provider authentication:

```bash
opencode --version
opencode auth list
```

## Connect the managed server

This is the simplest local setup:

1. Open the Agenvyl control center.
2. Choose **Configure connectors**.
3. Enable **OpenCode** and save.
4. Open **Agents** in the Web UI and choose the OpenCode instance, provider
   model, available reasoning effort, agent variant, and permissions.

When the CLI is available and no external endpoint is selected, Connector
manages a local `opencode serve` child process. CLI fallback:

```bash
agenvyl setup
```

## Connect an existing server

Start the server yourself:

```bash
opencode serve --hostname 127.0.0.1 --port 4096
```

Then start Agenvyl with:

```bash
export AGENVYL_CONNECTOR_OPENCODE_URL=http://127.0.0.1:4096
```

If the server requires HTTP Basic authentication:

```bash
export AGENVYL_CONNECTOR_OPENCODE_USERNAME=opencode
export AGENVYL_CONNECTOR_OPENCODE_PASSWORD=<server-password>
```

Keep credentials out of `connector.yaml` and source control. Set them in the
environment used for every Agenvyl start.

## Behavior and permissions

OpenCode supplies its model catalog and provider agent variants. Agenvyl
supports text and reasoning streams, tools, manual approvals, structured
clarifications with up to four questions including multi-select, usage, retries
reported by the provider, and cancellation.

Enabled OpenCode model variants appear as reasoning effort choices in Agenvyl.
The selected value is sent as a per-run OpenCode variant. **Auto** sends no
override and uses the model, agent, or global OpenCode default. A variant may
bundle reasoning budget with other settings such as text verbosity; the names
and exact behavior come from the current upstream catalog.

External-directory permission requests are rejected at the adapter boundary.
Malformed or unsupported question payloads fail closed instead of being
answered implicitly.

## Verify and troubleshoot

For a managed server:

```bash
opencode --version
opencode auth list
agenvyl logs connector --lines 200
```

Override a non-standard CLI location in the Agenvyl launch environment:

```bash
export AGENVYL_CONNECTOR_OPENCODE_COMMAND=/absolute/path/to/opencode
```

For an existing server, also confirm its endpoint from the Agenvyl host. If
catalog discovery needs a specific project context, set:

```bash
export AGENVYL_CONNECTOR_OPENCODE_CATALOG_DIRECTORY=/absolute/project/path
```

Executions still use the canonical Agenvyl room workspace.
