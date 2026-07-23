import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveSupervisorConfig } from './config.js';
import { uninstallPortable, windowsCleanupLaunch, windowsCleanupScript } from './uninstall.js';

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
    expect(script).toContain('Remove-Item -LiteralPath');
  });

  it('waits inside one hidden cleanup process without spawning ping windows', () => {
    const script = windowsCleanupScript(0);
    expect(script).toContain('Start-Sleep -Milliseconds 500');
    expect(script).toContain('$PSScriptRoot');
    expect(script).not.toContain('ping');
  });

  it('hides both the detached command host and its PowerShell child', () => {
    const launch = windowsCleanupLaunch('/tmp/uninstall.ps1', {}, '/Windows', '/tmp', 'cmd.exe');
    const powershell = join('/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    expect(launch.file).toBe('cmd.exe');
    expect(launch.args).toEqual(['/d', '/q', '/c', powershell, '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', '/tmp/uninstall.ps1']);
    expect(launch.options).toMatchObject({ cwd: '/tmp', detached: true, stdio: 'ignore', windowsHide: true });
  });

  it('removes only the portable bundle by default', async () => {
    const fixture = await portableFixture();
    await writeFile(join(fixture.config.paths.data, 'keep.txt'), 'user data');
    const stages: string[] = [];
    await uninstallPortable(fixture.config, {}, stage => stages.push(stage));
    expect(stages).toEqual(process.platform === 'win32' ? ['stopping', 'removing', 'scheduling'] : ['stopping', 'removing']);
    await waitForMissing(fixture.bundleRoot);
    await expect(readFile(join(fixture.config.paths.data, 'keep.txt'), 'utf8')).resolves.toBe('user data');
  });

  it('defers removal of the running Windows command shim', () => {
    const script = windowsCleanupScript(0, 1);
    expect(script).toContain('AGENVYL_UNINSTALL_FILE_0');
    expect(script).toContain('Remove-Item -LiteralPath');
  });

  it('removes the recorded owned command while preserving user data', async () => {
    const fixture = await portableFixture();
    await mkdir(fixture.config.userBinDirectory, { recursive: true });
    await writeFile(fixture.config.userCommandPath, `#!/bin/sh\n# Agenvyl owned command\n# Agenvyl bundle: ${fixture.bundleRoot}\n`);
    await writeFile(fixture.config.settingsFile, JSON.stringify({ schemaVersion: 2, locale: 'en', initializedAt: 'now', shortcuts: [], command: { path: fixture.config.userCommandPath, bundleRoot: fixture.bundleRoot, pathEntryAdded: false } }));
    await uninstallPortable(fixture.config);
    await waitForMissing(fixture.config.userCommandPath);
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
