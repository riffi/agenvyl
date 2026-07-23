# Connect Hermes

Hermes is attach-only. Unlike the CLI harnesses, Agenvyl does not start Hermes:
you must run an authenticated Hermes API Server that exposes its capabilities
and model catalog over HTTP.

## Before you start

Install and configure a current
[Hermes Agent](https://github.com/NousResearch/hermes-agent). Select and
authenticate an upstream model provider:

```bash
hermes model
hermes doctor
```

Use a current Hermes build whose API Server exposes `/v1/capabilities`,
`/v1/models`, and the structured `/v1/runs` lifecycle.

## Enable the API Server

Keep the API bound to loopback. Store its caller key in `~/.hermes/.env`, not
in the public Hermes or Agenvyl YAML:

```bash
API_SERVER_KEY=<generate-a-long-random-secret>
```

Protect that file with user-only permissions:

```bash
chmod 600 ~/.hermes/.env
```

In `~/.hermes/config.yaml`, enable the API Server and declare the names Agenvyl
should discover:

```yaml
gateway:
  platforms:
    api_server:
      enabled: true
      extra:
        host: 127.0.0.1
        port: 8642
        model_name: primary
        model_routes:
          review:
            model: provider/model-for-review
            provider: provider-id
          build:
            model: provider/model-for-coding
            provider: provider-id
```

`model_name` is the default advertised model. Every `model_routes` key is a
client-facing alias. Hermes automatically includes `primary`, `review`, and
`build` in authenticated `GET /v1/models`; when Agenvyl uses an alias, Hermes
routes it to the configured provider and upstream model.

Do not copy the placeholder provider or model IDs literally. Use provider names
and models already configured and working in your Hermes installation.

## Start and verify Hermes

Run the gateway in the foreground:

```bash
hermes gateway run
```

Or install and start the supported background service:

```bash
hermes gateway install
hermes gateway start
hermes gateway status
```

In another terminal, verify authentication, capabilities, and model aliases:

```bash
export HERMES_API_KEY=<same-api-server-secret>

curl -fsS \
  -H "Authorization: Bearer $HERMES_API_KEY" \
  http://127.0.0.1:8642/v1/capabilities

curl -fsS \
  -H "Authorization: Bearer $HERMES_API_KEY" \
  http://127.0.0.1:8642/v1/models
```

Do not continue until `/v1/models` returns a non-empty OpenAI-style `data`
array containing the names you want Agenvyl to show.

## Give Connector the endpoint and token

Connector currently reads the Hermes secret only from its process environment.
The setup UI does not store this token, and it must not be added to
`connector.yaml`.

### Windows

Set user environment variables, then open a new terminal:

```powershell
[Environment]::SetEnvironmentVariable(
  'AGENVYL_CONNECTOR_HERMES_URL',
  'http://127.0.0.1:8642',
  'User'
)
[Environment]::SetEnvironmentVariable(
  'AGENVYL_CONNECTOR_HERMES_TOKEN',
  '<same-api-server-secret>',
  'User'
)
```

### Linux and macOS

Export the values in the shell that starts Agenvyl:

```bash
export AGENVYL_CONNECTOR_HERMES_URL=http://127.0.0.1:8642
export AGENVYL_CONNECTOR_HERMES_TOKEN=<same-api-server-secret>
```

For persistence, place those exports in a user-only shell environment file and
source it from your shell profile. Restrict it with `chmod 600`. Be aware that
desktop launchers may not inherit interactive shell profiles; start `agenvyl`
from a terminal whose environment contains the variables.

Restart Agenvyl after changing them:

```bash
agenvyl stop
agenvyl start
```

## Connect it in Agenvyl

1. Open the control center and choose **Configure connectors**.
2. Enable **Hermes** after its endpoint reports ready.
3. Save the selection.
4. Open **Agents** and select the Hermes instance and one of the aliases
   returned by `/v1/models`.

CLI fallback:

```bash
agenvyl setup
```

## Troubleshoot

If Hermes is unavailable or has no models:

1. run `hermes gateway status`;
2. repeat the authenticated capability and model requests above;
3. check that Agenvyl was restarted with both Connector environment variables;
4. confirm the API remains on `127.0.0.1:8642`; and
5. inspect `agenvyl logs connector --lines 200`.

Never post the API key, Agenvyl Connector token, provider credentials, or an
unredacted environment dump in an issue.

