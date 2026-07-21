import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }))));

describe.skipIf(process.platform !== 'win32')('PowerShell installer integration', () => {
  it('installs a verified archive and invokes init without PATH integration when opted out', async () => {
    const root = await fixture(); roots.push(root.path);
    const command = `$ErrorActionPreference='Stop'; function Invoke-WebRequest { param([switch]$UseBasicParsing,[string]$Uri,[string]$OutFile); Copy-Item -LiteralPath (Join-Path $env:FIXTURE_DOWNLOAD_ROOT ([IO.Path]::GetFileName(([uri]$Uri).AbsolutePath))) -Destination $OutFile }; & '${resolve('packaging/install.ps1').replaceAll("'", "''")}' -NoPath -ManifestUrl 'https://fixture.test/agenvyl-release.txt' -InstallRoot $env:FIXTURE_INSTALL_ROOT`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { encoding: 'utf8', env: { ...process.env, LOCALAPPDATA: root.localAppData, FIXTURE_DOWNLOAD_ROOT: root.downloads, FIXTURE_INSTALL_ROOT: root.installRoot, AGENVYL_INIT_LOG: root.initLog } });
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(root.initLog, 'utf8')).toContain('init --locale en --shortcuts recommended --path none');
    await expect(stat(join(root.installRoot, '0.1.0', 'manifest.json'))).resolves.toBeTruthy();
  });
});

async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'agenvyl-windows-installer-'));
  const downloads = join(path, 'downloads'), bundleParent = join(path, 'bundle'), bundleRoot = join(bundleParent, 'agenvyl-0.1.0-windows-x64');
  const installRoot = join(path, 'versions'), localAppData = join(path, 'local'), initLog = join(path, 'init.log');
  await mkdir(join(bundleRoot, 'bin'), { recursive: true }); await mkdir(downloads);
  await writeFile(join(bundleRoot, 'manifest.json'), JSON.stringify({ name: 'agenvyl-portable-runtime', version: '0.1.0' }));
  await writeFile(join(bundleRoot, 'bin', 'agenvyl.cmd'), '@echo off\r\necho %* > "%AGENVYL_INIT_LOG%"\r\nexit /b 0\r\n');
  const filename = 'agenvyl-0.1.0-windows-x64.zip', archive = join(downloads, filename);
  const zip = spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-cf', archive, 'agenvyl-0.1.0-windows-x64'], { cwd: bundleParent, encoding: 'utf8' });
  if (zip.status !== 0) throw new Error(zip.stderr);
  const bytes = await readFile(archive), sha = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(downloads, 'agenvyl-release.txt'), `agenvyl-release-index-v1\nversion\t0.1.0\nchannel\tpreview\ntarget\twindows-x64\t${filename}\tzip\t${bytes.length}\t${sha}\thttps://fixture.test/${filename}\n`);
  return { path, downloads, installRoot, localAppData, initLog };
}
