import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveSupervisorConfig } from './config.js';
import { uninstallPortable, windowsCleanupScript } from './uninstall.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }))); });

describe('portable uninstall cleanup', () => {
  it('keeps user data out of the default Windows cleanup script', () => {
    const script = windowsCleanupScript(0);
    expect(script).toContain('AGENVYL_UNINSTALL_BUNDLE');
    expect(script).not.toContain('AGENVYL_UNINSTALL_DATA_');
  });

  it('removes every explicitly supplied data root during purge', () => {
    const script = windowsCleanupScript(2);
    expect(script).toContain('AGENVYL_UNINSTALL_DATA_0');
    expect(script).toContain('AGENVYL_UNINSTALL_DATA_1');
    expect(script).toContain('rmdir /s /q');
  });

  it('removes only the portable bundle by default', async () => {
    const fixture = await portableFixture();
    await writeFile(join(fixture.config.paths.data, 'keep.txt'), 'user data');
    await uninstallPortable(fixture.config);
    await waitForMissing(fixture.bundleRoot);
    await expect(readFile(join(fixture.config.paths.data, 'keep.txt'), 'utf8')).resolves.toBe('user data');
  });

  it('requires confirmation and purges portable files plus user data', async () => {
    const fixture = await portableFixture();
    await expect(uninstallPortable(fixture.config, { purge: true })).rejects.toThrow('--purge --yes');
    await uninstallPortable(fixture.config, { purge: true, confirmed: true });
    await waitForMissing(fixture.bundleRoot);
    await waitForMissing(fixture.config.paths.data);
  });
});

async function portableFixture() {
  const root = await mkdtemp(join(tmpdir(), 'agenvyl-uninstall-test-'));
  roots.push(root);
  const bundleRoot = join(root, 'portable'), home = join(root, 'home');
  await mkdir(bundleRoot, { recursive: true });
  await writeFile(join(bundleRoot, 'manifest.json'), JSON.stringify({ name: 'agenvyl-portable-runtime' }));
  const env = process.platform === 'win32' ? { LOCALAPPDATA: join(home, 'local') } : process.platform === 'darwin' ? {} : { XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data') };
  const config = resolveSupervisorConfig(env, { platform: process.platform as 'win32' | 'darwin' | 'linux', home, cwd: bundleRoot });
  await mkdir(config.paths.config, { recursive: true });
  await mkdir(config.paths.data, { recursive: true });
  return { root, bundleRoot, config };
}

async function waitForMissing(path: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { await stat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for uninstall: ${path}`);
}
