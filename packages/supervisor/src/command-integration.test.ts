import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveSupervisorConfig } from './config.js';
import { commandShim, installUserCommand, removeOwnedCommand } from './command-integration.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

describe('user command integration', () => {
  it('creates and repairs an owned POSIX shim and profile PATH line', async () => {
    const { config, root } = await fixture();
    const first = await installUserCommand(config);
    expect(first).toMatchObject({ path: config.userCommandPath, bundleRoot: config.bundleRoot, pathEntry: config.userBinDirectory, pathProfile: config.userProfileFile, pathEntryAdded: true });
    expect(await readFile(first.path, 'utf8')).toContain('Agenvyl owned command');
    expect(await readFile(config.userProfileFile, 'utf8')).toContain('Agenvyl owned PATH');
    const previous = { schemaVersion: 2 as const, locale: 'en' as const, initializedAt: 'now', shortcuts: [], command: first };
    await writeFile(first.path, 'damaged but Agenvyl owned command');
    const originalPath = process.env.PATH;
    process.env.PATH = config.userBinDirectory;
    try { await expect(installUserCommand(config, previous)).resolves.toEqual(first); }
    finally { process.env.PATH = originalPath; }
    await expect(removeOwnedCommand(previous, 'linux')).resolves.toMatchObject({ removed: [first.path, `User PATH profile: ${config.userProfileFile}`], deferredFiles: [] });
    await expect(stat(first.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(config.userProfileFile, 'utf8')).not.toContain('Agenvyl owned PATH');
    expect(root).toBeTruthy();
  });

  it('refuses to overwrite an unowned command', async () => {
    const { config } = await fixture();
    await mkdir(config.userBinDirectory, { recursive: true });
    await writeFile(config.userCommandPath, '#!/bin/sh\necho foreign\n');
    await expect(installUserCommand(config)).rejects.toMatchObject({ code: 'COMMAND_EXISTS' });
  });

  it('quotes a bundle path in the generated POSIX shim', async () => {
    const { config } = await fixture("bundle with ' quote");
    expect(commandShim(config)).toContain("bundle with '\\'' quote");
  });
});

async function fixture(bundle = 'bundle') {
  const root = await mkdtemp(join(tmpdir(), 'agenvyl-command-')); roots.push(root);
  const home = join(root, 'home');
  const windowsConfig = resolveSupervisorConfig({ LOCALAPPDATA: join(home, 'local') }, { platform: 'win32', home, cwd: join(root, bundle) });
  const userBinDirectory = join(home, '.local', 'bin');
  const config = { ...windowsConfig, platform: 'linux' as const, userBinDirectory, userCommandPath: join(userBinDirectory, 'agenvyl'), userProfileFile: join(home, '.profile') };
  return { config, root };
}
