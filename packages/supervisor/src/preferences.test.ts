import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveSupervisorConfig } from './config.js';
import { loadSettings, saveSettings } from './preferences.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

describe('supervisor settings', () => {
  it('round-trips versioned user-only preferences without secrets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenvyl-settings-')); roots.push(root);
    const config = resolveSupervisorConfig({ LOCALAPPDATA: join(root, 'local') }, { platform: 'win32', home: root, cwd: join(root, 'bundle') });
    const settings = { schemaVersion: 2 as const, locale: 'ru' as const, initializedAt: '2026-07-21T00:00:00.000Z', shortcuts: [] };
    await saveSettings(config, settings);
    await expect(loadSettings(config)).resolves.toEqual(settings);
    expect(await readFile(config.settingsFile, 'utf8')).not.toContain('token');
  });

  it('returns a stable typed error for invalid settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenvyl-settings-')); roots.push(root);
    const config = resolveSupervisorConfig({ LOCALAPPDATA: join(root, 'local') }, { platform: 'win32', home: root, cwd: join(root, 'bundle') });
    await saveSettings(config, { schemaVersion: 2, locale: 'en', initializedAt: 'now', shortcuts: [] });
    await writeFile(config.settingsFile, '{}');
    await expect(loadSettings(config)).rejects.toMatchObject({ code: 'SETTINGS_INVALID' });
  });

  it('upgrades settings v1 without losing locale or shortcuts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenvyl-settings-')); roots.push(root);
    const config = resolveSupervisorConfig({ LOCALAPPDATA: join(root, 'local') }, { platform: 'win32', home: root, cwd: join(root, 'bundle') });
    await mkdir(dirname(config.settingsFile), { recursive: true });
    await writeFile(config.settingsFile, JSON.stringify({ schemaVersion: 1, locale: 'en', initializedAt: 'before-v2', shortcuts: [] }));
    await expect(loadSettings(config)).resolves.toEqual({ schemaVersion: 2, locale: 'en', initializedAt: 'before-v2', shortcuts: [], command: undefined });
  });
});
