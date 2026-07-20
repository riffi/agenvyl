import { describe, expect, it } from 'vitest';
import { resolveAgenvylPaths } from './index.js';

describe('resolveAgenvylPaths', () => {
  it('uses the standard XDG layout below the user home', () => {
    expect(resolveAgenvylPaths({}, '/home/alice')).toEqual({
      config: '/home/alice/.config/agenvyl',
      data: '/home/alice/.local/share/agenvyl',
      connectorConfig: '/home/alice/.config/agenvyl/connector.yaml',
      workspaces: '/home/alice/.local/share/agenvyl/workspaces',
    });
  });

  it('honors absolute XDG roots and rejects relative roots', () => {
    expect(resolveAgenvylPaths({ XDG_CONFIG_HOME: '/config', XDG_DATA_HOME: '/data' }, '/ignored').workspaces).toBe('/data/agenvyl/workspaces');
    expect(() => resolveAgenvylPaths({ XDG_DATA_HOME: 'relative' }, '/home/alice')).toThrow('XDG_DATA_HOME must be an absolute path');
  });
});
