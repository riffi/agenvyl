import type { ConnectorAdapter } from '../adapter.js';
import type { ConnectorConfig } from '../config.js';
import { HermesConnectorAdapter } from './hermes/adapter.js';
import { OpenCodeConnectorAdapter } from './opencode/adapter.js';
import { AntigravityConnectorAdapter } from './antigravity/adapter.js';

export function buildConfiguredAdapters(config: ConnectorConfig, env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch) {
  const adapters = new Map<string, ConnectorAdapter>();
  const hermesInstances = config.instances.filter(instance => instance.enabled && instance.type === 'hermes');
  const hermesUrl = env.AGENVYL_CONNECTOR_HERMES_URL;
  if (hermesInstances.length && hermesUrl) {
    const adapter = new HermesConnectorAdapter({ baseUrl: hermesUrl, token: env.AGENVYL_CONNECTOR_HERMES_TOKEN, request });
    for (const instance of hermesInstances) adapters.set(instance.id, adapter);
  }
  const openCodeInstances = config.instances.filter(instance => instance.enabled && instance.type === 'opencode');
  const openCodeUrl = env.AGENVYL_CONNECTOR_OPENCODE_URL;
  if (openCodeInstances.length && openCodeUrl) {
    const adapter = new OpenCodeConnectorAdapter({
      baseUrl: openCodeUrl,
      username: env.AGENVYL_CONNECTOR_OPENCODE_USERNAME,
      password: env.AGENVYL_CONNECTOR_OPENCODE_PASSWORD,
      request,
      catalogDirectory: env.AGENVYL_CONNECTOR_OPENCODE_CATALOG_DIRECTORY,
    });
    for (const instance of openCodeInstances) adapters.set(instance.id, adapter);
  }
  const antigravityInstances = config.instances.filter(instance => instance.enabled && instance.type === 'antigravity');
  if (antigravityInstances.length && env.AGENVYL_CONNECTOR_AGY_DANGEROUSLY_SKIP_PERMISSIONS === 'true') {
    const adapter = new AntigravityConnectorAdapter({
      command: env.AGENVYL_CONNECTOR_AGY_COMMAND,
      env,
      printTimeoutMs: positiveInteger(env.AGENVYL_CONNECTOR_AGY_PRINT_TIMEOUT_MS, 30 * 60_000, 'AGENVYL_CONNECTOR_AGY_PRINT_TIMEOUT_MS'),
    });
    for (const instance of antigravityInstances) adapters.set(instance.id, adapter);
  }
  return adapters;
}

function positiveInteger(value: string | undefined, fallback: number, label: string) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}
