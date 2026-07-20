import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConnectorConfig } from './config.js';

const directories: string[] = [];
async function config(markdown: string) {
  const directory = await mkdtemp(join(tmpdir(), 'agenvyl-connector-'));
  directories.push(directory);
  const path = join(directory, 'connector.yaml');
  await writeFile(path, markdown);
  return path;
}
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

describe('Connector config', () => {
  it('loads v1 YAML with loopback defaults and env-only token', async () => {
    const path = await config('version: 1\ninstances:\n  - id: local-hermes\n    type: hermes\n');
    await expect(loadConnectorConfig({ path, env: { AGENVYL_CONNECTOR_TOKEN: 'x'.repeat(32) } })).resolves.toEqual({
      version: 1, listen: { host: '127.0.0.1', port: 4310 }, token: 'x'.repeat(32),
      workspaces: { roots: [] },
      instances: [{ id: 'local-hermes', type: 'hermes', enabled: true }],
    });
  });

  it('loads only explicit absolute workspace roots', async () => {
    const path = await config('version: 1\nworkspaces:\n  roots: [/srv/agenvyl/rooms, /mnt/team/rooms]\ninstances: []\n');
    await expect(loadConnectorConfig({ path, env: { AGENVYL_CONNECTOR_TOKEN: 'x'.repeat(32) } })).resolves.toMatchObject({
      workspaces: { roots: ['/srv/agenvyl/rooms', '/mnt/team/rooms'] },
    });
    const relative = await config('version: 1\nworkspaces:\n  roots: [../rooms]\ninstances: []\n');
    await expect(loadConnectorConfig({ path: relative, env: { AGENVYL_CONNECTOR_TOKEN: 'x'.repeat(32) } })).rejects.toThrow('must be an absolute path');
    const duplicates = await config('version: 1\nworkspaces:\n  roots: [/srv/rooms, /srv/rooms]\ninstances: []\n');
    await expect(loadConnectorConfig({ path: duplicates, env: { AGENVYL_CONNECTOR_TOKEN: 'x'.repeat(32) } })).rejects.toThrow('duplicate paths');
  });

  it('rejects weak credentials, duplicate instances and secrets in YAML', async () => {
    const valid = await config('version: 1\ninstances: []\n');
    await expect(loadConnectorConfig({ path: valid, env: {} })).rejects.toThrow('at least 32 characters');
    const duplicates = await config('version: 1\ninstances:\n  - { id: same, type: hermes }\n  - { id: same, type: opencode }\n');
    await expect(loadConnectorConfig({ path: duplicates, env: { AGENVYL_CONNECTOR_TOKEN: 'x'.repeat(32) } })).rejects.toThrow('Duplicate Connector instance id');
    const secret = await config('version: 1\ntoken: do-not-store-secrets-here\ninstances: []\n');
    await expect(loadConnectorConfig({ path: secret, env: { AGENVYL_CONNECTOR_TOKEN: 'x'.repeat(32) } })).rejects.toThrow('unsupported keys: token');
    const malformed = await config('version: 1\nsecret: [must-not-appear-in-error\n');
    await expect(loadConnectorConfig({ path: malformed, env: { AGENVYL_CONNECTOR_TOKEN: 'x'.repeat(32) } })).rejects.toThrow('Unable to parse Connector YAML config');
  });
});
