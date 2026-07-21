import { describe, expect, it } from 'vitest';
import { resolveSupervisorConfig } from './config.js';

describe('resolveSupervisorConfig', () => {
  it('uses managed PostgreSQL and platform data directories by default', () => {
    const config = resolveSupervisorConfig({ XDG_CONFIG_HOME: '/tmp/config', XDG_DATA_HOME: '/tmp/data' }, { platform: 'linux', home: '/home/test', cwd: '/opt/agenvyl' });
    expect(config).toMatchObject({ managedPostgres: true, postgresPort: 8793, connectorPort: 4310, corePort: 8791 });
    expect(config.paths.postgres).toBe('/tmp/data/agenvyl/postgres');
  });

  it('leaves an explicitly configured database unmanaged', () => {
    const config = resolveSupervisorConfig({ AGENVYL_DATABASE_URL: 'postgres://server/agenvyl', XDG_CONFIG_HOME: '/tmp/config', XDG_DATA_HOME: '/tmp/data' }, { platform: 'linux', home: '/home/test', cwd: '/opt/agenvyl' });
    expect(config.managedPostgres).toBe(false);
    expect(config.externalDatabaseUrl).toBe('postgres://server/agenvyl');
  });

  it('rejects invalid ports', () => {
    expect(() => resolveSupervisorConfig({ AGENVYL_PORT: '0', XDG_CONFIG_HOME: '/tmp/config', XDG_DATA_HOME: '/tmp/data' }, { platform: 'linux', home: '/home/test' })).toThrow('AGENVYL_PORT');
  });

  it('supports an explicit portable home for isolated macOS lifecycle', () => {
    const config = resolveSupervisorConfig({ AGENVYL_HOME: '/tmp/portable-home' }, { platform: 'darwin', cwd: '/opt/agenvyl' });
    expect(config.paths.config).toBe('/tmp/portable-home/Library/Application Support/Agenvyl');
  });
});
