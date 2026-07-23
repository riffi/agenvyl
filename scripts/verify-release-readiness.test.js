import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyReleaseReadiness } from './verify-release-readiness.mjs';

const roots = [];

afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'agenvyl-release-verify-'));
  roots.push(root);
  await mkdir(join(root, 'packages', 'contracts'), { recursive: true });
  await mkdir(join(root, 'apps', 'connector'), { recursive: true });
  await mkdir(join(root, 'docs', 'releases'), { recursive: true });

  const rootManifest = {
    name: 'agenvyl',
    version: '1.2.3',
    workspaces: ['packages/contracts', 'apps/connector'],
    dependencies: { '@agenvyl/contracts': '1.2.3' },
  };
  const contractsManifest = { name: '@agenvyl/contracts', version: '1.2.3' };
  const connectorManifest = {
    name: '@agenvyl/connector',
    version: '1.2.3',
    dependencies: { '@agenvyl/contracts': '1.2.3' },
  };
  const lock = {
    name: 'agenvyl',
    version: '1.2.3',
    lockfileVersion: 3,
    packages: {
      '': { name: 'agenvyl', version: '1.2.3', dependencies: { '@agenvyl/contracts': '1.2.3' } },
      'packages/contracts': { name: '@agenvyl/contracts', version: '1.2.3' },
      'apps/connector': {
        name: '@agenvyl/connector',
        version: '1.2.3',
        dependencies: { '@agenvyl/contracts': '1.2.3' },
      },
    },
  };

  await writeJson(join(root, 'package.json'), rootManifest);
  await writeJson(join(root, 'packages', 'contracts', 'package.json'), contractsManifest);
  await writeJson(join(root, 'apps', 'connector', 'package.json'), connectorManifest);
  await writeJson(join(root, 'package-lock.json'), lock);
  await writeFile(join(root, 'docs', 'releases', 'v1.2.3.md'), '# Agenvyl v1.2.3\n');

  return { root, rootManifest, contractsManifest, connectorManifest, lock };
}

describe('release readiness verification', () => {
  it('accepts consistent manifests, lockfile, pins, and release notes', async () => {
    const fixture = await createFixture();
    await expect(verifyReleaseReadiness(fixture.root)).resolves.toMatchObject({
      version: '1.2.3',
      manifestCount: 3,
      releaseNotes: 'docs/releases/v1.2.3.md',
    });
  });

  it('rejects a workspace version mismatch', async () => {
    const fixture = await createFixture();
    await writeJson(join(fixture.root, 'packages', 'contracts', 'package.json'), {
      ...fixture.contractsManifest,
      version: '1.2.2',
    });
    await expect(verifyReleaseReadiness(fixture.root)).rejects.toThrow(
      'packages/contracts/package.json has version 1.2.2; expected 1.2.3',
    );
  });

  it('rejects a stale internal dependency pin', async () => {
    const fixture = await createFixture();
    await writeJson(join(fixture.root, 'apps', 'connector', 'package.json'), {
      ...fixture.connectorManifest,
      dependencies: { '@agenvyl/contracts': '1.2.2' },
    });
    await expect(verifyReleaseReadiness(fixture.root)).rejects.toThrow(
      'apps/connector/package.json pins @agenvyl/contracts to 1.2.2',
    );
  });

  it('rejects a lockfile that does not match the manifests', async () => {
    const fixture = await createFixture();
    await writeJson(join(fixture.root, 'package-lock.json'), { ...fixture.lock, version: '1.2.2' });
    await expect(verifyReleaseReadiness(fixture.root)).rejects.toThrow(
      'package-lock.json has top-level version 1.2.2; expected 1.2.3',
    );
  });

  it('rejects missing versioned release notes', async () => {
    const fixture = await createFixture();
    await rm(join(fixture.root, 'docs', 'releases', 'v1.2.3.md'));
    await expect(verifyReleaseReadiness(fixture.root)).rejects.toThrow('docs/releases/v1.2.3.md is missing');
  });
});
