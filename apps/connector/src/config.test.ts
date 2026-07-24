import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addOpenCodeExternalDirectoryRoot,loadConnectorConfig,saveConnectorInstances } from './config.js';

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
    const workspaceRoot = join(tmpdir(), 'agenvyl-test-data', 'workspaces');
    await expect(loadConnectorConfig({ path, env: { AGENVYL_CONNECTOR_TOKEN: 'x'.repeat(32), AGENVYL_WORKSPACE_ROOT: workspaceRoot } })).resolves.toEqual({
      version: 1, listen: { host: '127.0.0.1', port: 4310 }, token: 'x'.repeat(32),
      path,
      workspaces: { roots: [workspaceRoot] },
      instances: [{ id: 'local-hermes', type: 'hermes', enabled: true }],
    });
  });

  it('uses one explicit workspace override when YAML roots are empty', async () => {
    const path = await config('version: 1\nworkspaces:\n  roots: []\ninstances: []\n');
    await expect(loadConnectorConfig({ path, env: { AGENVYL_CONNECTOR_TOKEN: 'x'.repeat(32), AGENVYL_WORKSPACE_ROOT: '/srv/agenvyl/workspaces' } })).resolves.toMatchObject({
      workspaces: { roots: ['/srv/agenvyl/workspaces'] },
    });
  });

  it('atomically persists non-secret instance settings without the bearer token',async()=>{const path=await config('version: 1\ninstances: []\n'),loaded=await loadConnectorConfig({path,env:{AGENVYL_CONNECTOR_TOKEN:'x'.repeat(32),AGENVYL_WORKSPACE_ROOT:'/srv/workspaces'}});await saveConnectorInstances(loaded,[{id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:true,externalDirectoryRoots:['/srv/shared']}]);const saved=await readFile(path,'utf8');expect(saved).toContain('managed: true');expect(saved).toContain('/srv/shared');expect(saved).not.toContain('xxxxxxxx');expect((await loadConnectorConfig({path,env:{AGENVYL_CONNECTOR_TOKEN:'x'.repeat(32)}})).instances[0]).toMatchObject({id:'local-opencode',managed:true,externalDirectoryRoots:['/srv/shared']});});
  it('persists a user-approved OpenCode external root once',async()=>{const path=await config('version: 1\ninstances:\n  - { id: local-opencode, type: opencode, enabled: true }\n'),loaded=await loadConnectorConfig({path,env:{AGENVYL_CONNECTOR_TOKEN:'x'.repeat(32)}});await expect(addOpenCodeExternalDirectoryRoot(loaded,'local-opencode','C:\\work')).resolves.toBe(true);await expect(addOpenCodeExternalDirectoryRoot(loaded,'local-opencode','c:\\work\\')).resolves.toBe(false);expect(loaded.instances[0]).toMatchObject({externalDirectoryRoots:['C:\\work']});expect((await loadConnectorConfig({path,env:{AGENVYL_CONNECTOR_TOKEN:'x'.repeat(32)}})).instances[0]).toMatchObject({externalDirectoryRoots:['C:\\work']});});
  it('persists only declared config fields after a server mutates its listen options',async()=>{const path=await config('version: 1\nlisten: { host: 127.0.0.1, port: 4310 }\ninstances: []\n'),loaded=await loadConnectorConfig({path,env:{AGENVYL_CONNECTOR_TOKEN:'x'.repeat(32),AGENVYL_WORKSPACE_ROOT:'/srv/workspaces'}});Object.assign(loaded.listen,{listenTextResolver:()=>''});await expect(saveConnectorInstances(loaded,[])).resolves.toBeUndefined();expect(await readFile(path,'utf8')).not.toContain('listenTextResolver');});

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

  it('accepts the OAuth confirmation flag only for Claude',async()=>{const valid=await config('version: 1\ninstances:\n  - { id: local-claude, type: claude, enabled: true, allowSubscriptionOAuth: true }\n');await expect(loadConnectorConfig({path:valid,env:{AGENVYL_CONNECTOR_TOKEN:'x'.repeat(32)}})).resolves.toMatchObject({instances:[{type:'claude',allowSubscriptionOAuth:true}]});const invalid=await config('version: 1\ninstances:\n  - { id: local-codex, type: codex, enabled: true, allowSubscriptionOAuth: true }\n');await expect(loadConnectorConfig({path:invalid,env:{AGENVYL_CONNECTOR_TOKEN:'x'.repeat(32)}})).rejects.toThrow('allowSubscriptionOAuth');});
  it('rejects endpoints and cross-harness danger flags for Claude',async()=>{const endpoint=await config('version: 1\ninstances:\n  - { id: local-claude, type: claude, enabled: true, endpoint: http://127.0.0.1:1 }\n');await expect(loadConnectorConfig({path:endpoint,env:{AGENVYL_CONNECTOR_TOKEN:'x'.repeat(32)}})).rejects.toThrow('invalid for Claude');const danger=await config('version: 1\ninstances:\n  - { id: local-claude, type: claude, enabled: true, allowDangerFullAccess: true }\n');await expect(loadConnectorConfig({path:danger,env:{AGENVYL_CONNECTOR_TOKEN:'x'.repeat(32)}})).rejects.toThrow('allowDangerFullAccess');});
  it.each(['../shared','/srv/*','/srv/shared/../secret','C:\\Shared/mixed'])('rejects unsafe OpenCode external root %s',async root=>{const path=await config(`version: 1\ninstances:\n  - id: local-opencode\n    type: opencode\n    externalDirectoryRoots: [${JSON.stringify(root)}]\n`);await expect(loadConnectorConfig({path,env:{AGENVYL_CONNECTOR_TOKEN:'x'.repeat(32)}})).rejects.toThrow('externalDirectoryRoots');});
  it('rejects external roots on other harnesses',async()=>{const path=await config('version: 1\ninstances:\n  - id: local-hermes\n    type: hermes\n    externalDirectoryRoots: []\n');await expect(loadConnectorConfig({path,env:{AGENVYL_CONNECTOR_TOKEN:'x'.repeat(32)}})).rejects.toThrow('externalDirectoryRoots');});
});
