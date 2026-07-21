import { describe, expect, it } from 'vitest';
import { mergeConnectorSelection, type SetupState } from './setup.js';

const state: SetupState = {
  completed: true,
  instances: [{ id: 'my-opencode', type: 'opencode', status: 'healthy', managed: true }],
  candidates: [
    { type: 'opencode', label: 'OpenCode', cli: { found: true }, endpoint: { url: 'http://127.0.0.1:4096', reachable: true }, safeToSelect: true },
    { type: 'antigravity', label: 'AGY', cli: { found: true }, safeToSelect: true },
  ],
};

describe('connector selection merge', () => {
  it('preserves managed OpenCode ownership when Web UI and TUI edit sequentially', () => {
    expect(mergeConnectorSelection(state, ['opencode'], false)[0]).toMatchObject({ id: 'my-opencode', managed: true, enabled: true });
  });

  it('defaults confirmed AGY to plan and never enables it without confirmation', () => {
    expect(mergeConnectorSelection(state, ['antigravity'], false)[1]).not.toHaveProperty('permissionMode');
    expect(mergeConnectorSelection(state, ['antigravity'], true)[1]).toMatchObject({ enabled: true, permissionMode: 'plan' });
  });
});
