import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RUNTIME_BUNDLE_TARGETS, runtimeBundleArchiveName } from './runtime-bundle-config.mjs';
import { createReleaseManifest, releaseIndex } from './release-manifest.mjs';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

describe('release manifest', () => {
  it('describes all five archives with deterministic checksums and a shell-readable index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenvyl-release-')); roots.push(root);
    const archives = [];
    for (const target of RUNTIME_BUNDLE_TARGETS) {
      const path = join(root, runtimeBundleArchiveName('0.1.0', target));
      await writeFile(path, `${target.platform}-${target.architecture}`);
      archives.push(path);
    }
    const manifest = await createReleaseManifest({ version: '0.1.0', channel: 'preview', baseUrl: 'https://example.test/v0.1.0/', archives, publishedAt: '2026-07-21T00:00:00.000Z' });
    expect(manifest.targets).toHaveLength(5);
    expect(manifest.targets[0]).toMatchObject({ target: 'linux-x64', archiveFormat: 'tar.xz', url: 'https://example.test/v0.1.0/agenvyl-0.1.0-linux-x64.tar.xz' });
    expect(manifest.targets.every(target => /^[a-f0-9]{64}$/u.test(target.sha256))).toBe(true);
    expect(releaseIndex(manifest).split('\n').some(line => line.startsWith('target\twindows-x64\t'))).toBe(true);
  });

  it('fails closed when a target archive is missing', async () => {
    await expect(createReleaseManifest({ version: '0.1.0', baseUrl: 'https://example.test/', archives: [] })).rejects.toThrow('Missing release archive');
  });
});
