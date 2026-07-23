import { describe, expect, it } from 'vitest';
import type { ConnectorConfig } from '../config.js';
import { buildConfiguredAdapters } from './factory.js';

describe('buildConfiguredAdapters', () => {
  it('loads enabled Hermes instances only when the endpoint is configured', () => {
    expect(buildConfiguredAdapters(config(), {})).toHaveLength(0);
    const adapters = buildConfiguredAdapters(config(), { AGENVYL_CONNECTOR_HERMES_URL: 'http://localhost:8642' });
    expect([...adapters.keys()]).toEqual(['local-hermes']);
    expect(adapters.get('local-hermes')).toMatchObject({ type: 'hermes', capabilities: ['model_catalog','execution_profiles','text_streaming', 'tools', 'approvals', 'usage'] });
  });

  it('loads Codex while keeping disabled instances unloaded', () => {
    const value = config();
    value.instances = [
      { id: 'disabled-hermes', type: 'hermes', enabled: false },
      { id: 'local-codex', type: 'codex', enabled: true },
    ];
    const adapters=buildConfiguredAdapters(value, { AGENVYL_CONNECTOR_HERMES_URL: 'http://localhost:8642',AGENVYL_CONNECTOR_CODEX_COMMAND:'codex-custom' });
    expect([...adapters.keys()]).toEqual(['local-codex']);expect(adapters.get('local-codex')).toMatchObject({type:'codex'});
  });

  it('loads enabled OpenCode instances only when the server endpoint is configured', () => {
    const value = config();
    value.instances = [{ id: 'local-opencode', type: 'opencode', enabled: true }];
    expect(buildConfiguredAdapters(value, {})).toHaveLength(0);
    const adapters = buildConfiguredAdapters(value, { AGENVYL_CONNECTOR_OPENCODE_URL: 'http://127.0.0.1:4096' });
    expect([...adapters.keys()]).toEqual(['local-opencode']);
    expect(adapters.get('local-opencode')).toMatchObject({ type: 'opencode', capabilities: ['model_catalog', 'execution_profiles', 'text_streaming', 'reasoning', 'tools', 'approvals', 'clarifications', 'usage'] });
  });

  it('loads Antigravity only behind the persisted explicit permission mode', () => {
    const value = config();
    value.instances = [{ id: 'local-antigravity', type: 'antigravity', enabled: true }];
    expect(buildConfiguredAdapters(value, {})).toHaveLength(0);
    value.instances=[{...value.instances[0],permissionMode:'plan'}];
    const adapters = buildConfiguredAdapters(value, {
      AGENVYL_CONNECTOR_AGY_COMMAND: '/opt/agy',
      AGENVYL_CONNECTOR_AGY_PRINT_TIMEOUT_MS: '1200000',
    });
    expect([...adapters.keys()]).toEqual(['local-antigravity']);
    expect(adapters.get('local-antigravity')).toMatchObject({ type: 'antigravity', capabilities: ['model_catalog', 'execution_profiles'] });
    expect(() => buildConfiguredAdapters(value, { AGENVYL_CONNECTOR_AGY_PRINT_TIMEOUT_MS: 'invalid' })).toThrow('must be a positive integer');
  });
});

function config(): ConnectorConfig {
  return {
    version: 1,
    listen: { host: '127.0.0.1', port: 4310 },
    workspaces: { roots: ['/srv/workspaces'] },
    instances: [{ id: 'local-hermes', type: 'hermes', enabled: true }],
    token: 'x'.repeat(32),
  };
}
