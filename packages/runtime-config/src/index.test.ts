import { describe, expect, it } from 'vitest';
import { resolveAgenvylPaths } from './index.js';

describe('resolveAgenvylPaths', () => {
  it('uses the standard XDG layout below the user home', () => {
    expect(resolveAgenvylPaths({}, '/home/alice')).toEqual({
      config: '/home/alice/.config/agenvyl',
      data: '/home/alice/.local/share/agenvyl',
      backups: '/home/alice/.local/share/agenvyl/backups',
      connectorConfig: '/home/alice/.config/agenvyl/connector.yaml',
      logs: '/home/alice/.local/share/agenvyl/logs',
      postgres: '/home/alice/.local/share/agenvyl/postgres',
      state: '/home/alice/.local/share/agenvyl/state',
      workspaces: '/home/alice/.local/share/agenvyl/workspaces',
    });
  });

  it('honors absolute XDG roots and rejects relative roots', () => {
    expect(resolveAgenvylPaths({ XDG_CONFIG_HOME: '/config', XDG_DATA_HOME: '/data' }, '/ignored').workspaces).toBe('/data/agenvyl/workspaces');
    expect(() => resolveAgenvylPaths({ XDG_DATA_HOME: 'relative' }, '/home/alice')).toThrow('XDG_DATA_HOME must be an absolute path');
  });

  it('uses Application Support on macOS', () => {
    expect(resolveAgenvylPaths({}, '/Users/Alice', 'darwin')).toMatchObject({
      config: '/Users/Alice/Library/Application Support/Agenvyl',
      data: '/Users/Alice/Library/Application Support/Agenvyl',
      postgres: '/Users/Alice/Library/Application Support/Agenvyl/postgres',
    });
  });

  it('uses LocalAppData and Windows path semantics on Windows', () => {
    expect(resolveAgenvylPaths({ LOCALAPPDATA: 'D:\\Profiles\\Alice\\Local' }, 'C:\\Users\\Alice', 'win32')).toMatchObject({
      config: 'D:\\Profiles\\Alice\\Local\\Agenvyl',
      data: 'D:\\Profiles\\Alice\\Local\\Agenvyl',
      workspaces: 'D:\\Profiles\\Alice\\Local\\Agenvyl\\workspaces',
    });
    expect(() => resolveAgenvylPaths({ LOCALAPPDATA: 'relative' }, 'C:\\Users\\Alice', 'win32')).toThrow('LOCALAPPDATA must be an absolute path');
  });
});
