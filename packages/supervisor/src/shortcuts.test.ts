import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeOwnedShortcuts } from './shortcuts.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

describe('shortcut ownership', () => {
  it('removes only recorded shortcuts that still identify the owning bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenvyl-shortcuts-')); roots.push(root);
    const bundleRoot = join(root, 'bundle'), owned = join(root, 'owned.cmd'), foreign = join(root, 'foreign.cmd');
    await writeFile(owned, `rem Agenvyl bundle: ${bundleRoot}`); await writeFile(foreign, 'rem another application');
    const settings = { schemaVersion: 1 as const, locale: 'en' as const, initializedAt: 'now', shortcuts: [{ kind: 'desktop' as const, path: owned, bundleRoot }, { kind: 'desktop' as const, path: foreign, bundleRoot }] };
    await expect(removeOwnedShortcuts(settings)).resolves.toEqual([owned]);
    await expect(stat(owned)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(foreign, 'utf8')).resolves.toBe('rem another application');
  });
});
