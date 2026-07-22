import type { ConnectorAdapter } from '../adapter.js';
import type { ConnectorConfig } from '../config.js';
import { HermesConnectorAdapter } from './hermes/adapter.js';
import { OpenCodeConnectorAdapter } from './opencode/adapter.js';
import { AntigravityConnectorAdapter } from './antigravity/adapter.js';
import { CodexConnectorAdapter } from './codex/adapter.js';
import { ClaudeConnectorAdapter } from './claude/adapter.js';

export function buildConfiguredAdapters(config: ConnectorConfig, env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch) {
  const adapters = new Map<string, ConnectorAdapter>();
  const hermesInstances = config.instances.filter(instance => instance.enabled && instance.type === 'hermes');
  for (const instance of hermesInstances) {
    const hermesUrl=instance.endpoint??env.AGENVYL_CONNECTOR_HERMES_URL;
    if(!hermesUrl)continue;
    adapters.set(instance.id,new HermesConnectorAdapter({ baseUrl: hermesUrl, token: env.AGENVYL_CONNECTOR_HERMES_TOKEN, request }));
  }
  const openCodeInstances = config.instances.filter(instance => instance.enabled && instance.type === 'opencode');
  for (const instance of openCodeInstances) {
    const openCodeUrl=instance.endpoint??env.AGENVYL_CONNECTOR_OPENCODE_URL;
    if(!openCodeUrl)continue;
    adapters.set(instance.id,new OpenCodeConnectorAdapter({
      baseUrl: openCodeUrl,
      username: env.AGENVYL_CONNECTOR_OPENCODE_USERNAME,
      password: env.AGENVYL_CONNECTOR_OPENCODE_PASSWORD,
      request,
      catalogDirectory: env.AGENVYL_CONNECTOR_OPENCODE_CATALOG_DIRECTORY,
    }));
  }
  const antigravityInstances = config.instances.filter(instance => instance.enabled && instance.type === 'antigravity');
  if (antigravityInstances.length) {
    const adapter = new AntigravityConnectorAdapter({
      command: env.AGENVYL_CONNECTOR_AGY_COMMAND,
      env,
      printTimeoutMs: positiveInteger(env.AGENVYL_CONNECTOR_AGY_PRINT_TIMEOUT_MS, 30 * 60_000, 'AGENVYL_CONNECTOR_AGY_PRINT_TIMEOUT_MS'),
    });
    for (const instance of antigravityInstances) if(instance.permissionMode)adapters.set(instance.id, adapter);
  }
  for(const instance of config.instances.filter(candidate=>candidate.enabled&&candidate.type==='codex'))adapters.set(instance.id,new CodexConnectorAdapter({
    command:env.AGENVYL_CONNECTOR_CODEX_COMMAND,
    env,
    allowDangerFullAccess:instance.allowDangerFullAccess,
  }));
  for(const instance of config.instances.filter(candidate=>candidate.enabled&&candidate.type==='claude'))adapters.set(instance.id,new ClaudeConnectorAdapter({
    command:env.AGENVYL_CONNECTOR_CLAUDE_COMMAND,
    env,
    allowSubscriptionOAuth:instance.allowSubscriptionOAuth,
  }));
  return adapters;
}

function positiveInteger(value: string | undefined, fallback: number, label: string) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}
