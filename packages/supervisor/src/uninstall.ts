import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import type { SupervisorConfig } from './config.js';
import { purgeWindowsPostgresStorage, stopSupervisor } from './runtime.js';
import { loadSettings } from './preferences.js';
import { removeOwnedShortcuts } from './shortcuts.js';
import { removeOwnedCommand } from './command-integration.js';

export type UninstallResult = { scheduled: boolean; purge: boolean; removed: string[]; preserved: string[] };
export type UninstallStage = 'stopping' | 'removing' | 'scheduling';

export async function uninstallPortable(config: SupervisorConfig, options: { purge?: boolean; confirmed?: boolean } = {}, progress?: (stage: UninstallStage) => void): Promise<UninstallResult> {
  const purge = options.purge === true;
  if (purge && !options.confirmed) throw new Error('Full uninstall deletes all Agenvyl user data; repeat with --purge --yes');
  await assertPortableBundle(config.bundleRoot);
  const dataRoots = uniquePaths([config.paths.config, config.paths.data]);
  validateTargets(config.bundleRoot, dataRoots, purge);
  progress?.('stopping');
  await stopSupervisor(config);
  progress?.('removing');
  const settings = await loadSettings(config);
  const shortcuts = await removeOwnedShortcuts(settings);
  const command = await removeOwnedCommand(settings, config.platform, config.platform === 'win32');
  if (purge) await purgeWindowsPostgresStorage(config);
  const removed = [config.bundleRoot, ...shortcuts, ...command.removed, ...(purge ? dataRoots : [])];
  const preserved = purge ? [] : dataRoots;
  if (config.platform === 'win32') {
    progress?.('scheduling');
    await scheduleWindowsRemoval(config.bundleRoot, purge ? dataRoots : [], command.deferredFiles);
    return { scheduled: true, purge, removed, preserved };
  }
  if (purge) for (const path of dataRoots) await rm(path, { recursive: true, force: true });
  await rm(config.bundleRoot, { recursive: true, force: true });
  return { scheduled: false, purge, removed, preserved };
}

async function assertPortableBundle(bundleRoot: string) {
  const manifestPath = join(bundleRoot, 'manifest.json');
  let manifest: unknown;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch { throw new Error(`Uninstall is only available from a valid Agenvyl portable bundle: ${manifestPath}`); }
  if (!manifest || typeof manifest !== 'object' || (manifest as { name?: unknown }).name !== 'agenvyl-portable-runtime') {
    throw new Error(`Uninstall refused an unrecognized bundle: ${bundleRoot}`);
  }
}

function validateTargets(bundleRoot: string, dataRoots: string[], purge: boolean) {
  for (const target of [bundleRoot, ...dataRoots]) assertSafeDirectory(target);
  if (!purge && dataRoots.some(path => contains(bundleRoot, path))) throw new Error('User data is inside the portable bundle and cannot be preserved while removing it');
}

function assertSafeDirectory(value: string) {
  const target = resolve(value), root = parse(target).root;
  if (!isAbsolute(target) || target === root || target === dirname(target)) throw new Error(`Refusing to recursively remove unsafe path: ${value}`);
}

function contains(parent: string, child: string) {
  const nested = relative(resolve(parent), resolve(child));
  return nested === '' || (!nested.startsWith('..') && !isAbsolute(nested));
}

function uniquePaths(values: string[]) { return [...new Set(values.map(value => resolve(value)))]; }

async function scheduleWindowsRemoval(bundleRoot: string, dataRoots: string[], files: string[]) {
  const cleanupRoot = await mkdtemp(join(tmpdir(), 'agenvyl-uninstall-'));
  const script = join(cleanupRoot, 'uninstall.ps1');
  await writeFile(script, windowsCleanupScript(dataRoots.length, files.length), 'utf8');
  const env: NodeJS.ProcessEnv = { ...process.env, AGENVYL_UNINSTALL_BUNDLE: bundleRoot };
  dataRoots.forEach((path, index) => { env[`AGENVYL_UNINSTALL_DATA_${index}`] = path; });
  files.forEach((path, index) => { env[`AGENVYL_UNINSTALL_FILE_${index}`] = path; });
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { cwd: tmpdir(), env, stdio: 'ignore', windowsHide: true });
  child.unref();
}

export function windowsCleanupScript(dataRootCount: number, fileCount = 0) {
  const removeData = Array.from({ length: dataRootCount }, (_, index) => `Remove-Item -LiteralPath $env:AGENVYL_UNINSTALL_DATA_${index} -Recurse -Force -ErrorAction SilentlyContinue`).join('\r\n');
  const removeFiles = Array.from({ length: fileCount }, (_, index) => `Remove-Item -LiteralPath $env:AGENVYL_UNINSTALL_FILE_${index} -Force -ErrorAction SilentlyContinue`).join('\r\n');
  return `$ErrorActionPreference = 'SilentlyContinue'\r\n$removed = $false\r\nfor ($attempt = 0; $attempt -lt 120; $attempt += 1) {\r\n  Remove-Item -LiteralPath $env:AGENVYL_UNINSTALL_BUNDLE -Recurse -Force -ErrorAction SilentlyContinue\r\n  if (-not (Test-Path -LiteralPath $env:AGENVYL_UNINSTALL_BUNDLE)) { $removed = $true; break }\r\n  Start-Sleep -Milliseconds 500\r\n}\r\nif (-not $removed) { exit 1 }\r\n${removeFiles}${removeFiles ? '\r\n' : ''}${removeData}${removeData ? '\r\n' : ''}$cleanupRoot = $PSScriptRoot\r\nRemove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue\r\nRemove-Item -LiteralPath $cleanupRoot -Force -ErrorAction SilentlyContinue\r\n`;
}
