import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

describe.skipIf(process.platform === 'win32')('POSIX installer integration', () => {
  it('installs and repeats a checksum-verified release through init --path user', async () => {
    const root = await fixture(); roots.push(root.path);
    const first = runInstaller(root);
    expect(first.status, first.stderr).toBe(0);
    expect(await readFile(root.initLog, 'utf8')).toContain('init --locale en --shortcuts recommended --path user');
    await expect(stat(join(root.installRoot, '0.1.0', 'manifest.json'))).resolves.toBeTruthy();

    const repeated = runInstaller(root);
    expect(repeated.status, repeated.stderr).toBe(0);
    await expect(stat(join(root.installRoot, '0.1.0', 'manifest.json'))).resolves.toBeTruthy();
  });

  it('rejects a checksum mismatch before touching an installed version', async () => {
    const root = await fixture(); roots.push(root.path);
    const destination = join(root.installRoot, '0.1.0');
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'keep.txt'), 'previous');
    await writeFile(root.index, (await readFile(root.index, 'utf8')).replace(/[a-f0-9]{64}/u, '0'.repeat(64)));
    const result = runInstaller(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Archive checksum mismatch');
    await expect(readFile(join(destination, 'keep.txt'), 'utf8')).resolves.toBe('previous');
  });
});

async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'agenvyl-installer-'));
  const downloads = join(path, 'downloads'), bundleParent = join(path, 'bundle'), fakeBin = join(path, 'fake-bin');
  const installRoot = join(path, 'versions'), userBin = join(path, 'user-bin'), initLog = join(path, 'init.log');
  await mkdir(join(bundleParent, 'agenvyl-0.1.0-linux-x64', 'bin'), { recursive: true });
  await mkdir(downloads); await mkdir(fakeBin);
  const bundleRoot = join(bundleParent, 'agenvyl-0.1.0-linux-x64');
  await writeFile(join(bundleRoot, 'manifest.json'), JSON.stringify({ name: 'agenvyl-portable-runtime', version: '0.1.0' }));
  await writeFile(join(bundleRoot, 'bin', 'agenvyl'), '#!/bin/sh\nprintf "%s\\n" "$*" > "$AGENVYL_INIT_LOG"\n');
  await chmod(join(bundleRoot, 'bin', 'agenvyl'), 0o755);
  const filename = 'agenvyl-0.1.0-linux-x64.tar.xz';
  const archive = join(downloads, filename);
  run('tar', ['-cJf', archive, '-C', bundleParent, 'agenvyl-0.1.0-linux-x64']);
  const bytes = await readFile(archive), sha = createHash('sha256').update(bytes).digest('hex');
  const index = join(downloads, 'agenvyl-release.txt');
  await writeFile(index, `agenvyl-release-index-v1\nversion\t0.1.0\nchannel\tpreview\ntarget\tlinux-x64\t${filename}\ttar.xz\t${bytes.length}\t${sha}\thttps://fixture.test/${filename}\n`);
  await writeFile(join(fakeBin, 'curl'), '#!/bin/sh\ndest=\nurl=\nwhile [ "$#" -gt 0 ]; do case "$1" in --output) dest=$2; shift 2;; https://*) url=$1; shift;; *) shift;; esac; done\ncp "$FIXTURE_DOWNLOAD_ROOT/${url##*/}" "$dest"\n');
  await writeFile(join(fakeBin, 'uname'), '#!/bin/sh\nif [ "${1:-}" = "-s" ]; then echo Linux; else echo x86_64; fi\n');
  await chmod(join(fakeBin, 'curl'), 0o755); await chmod(join(fakeBin, 'uname'), 0o755);
  return { path, downloads, installRoot, userBin, initLog, index, fakeBin };
}

function runInstaller(root) {
  return spawnSync('sh', ['packaging/install.sh'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, PATH: `${root.fakeBin}:${process.env.PATH}`, HOME: root.path, FIXTURE_DOWNLOAD_ROOT: root.downloads, AGENVYL_MANIFEST_URL: 'https://fixture.test/agenvyl-release.txt', AGENVYL_INSTALL_ROOT: root.installRoot, AGENVYL_USER_BIN_DIR: root.userBin, AGENVYL_INIT_LOG: root.initLog } });
}

function run(command, args) { const result = spawnSync(command, args, { encoding: 'utf8' }); if (result.status !== 0) throw new Error(result.stderr); }
