import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import type { SupervisorConfig } from './config.js';
import { purgeWindowsPostgresStorage, stopSupervisor } from './runtime.js';
import { loadSettings } from './preferences.js';
import { removeOwnedShortcuts } from './shortcuts.js';

export type UninstallResult = { scheduled: boolean; purge: boolean; removed: string[]; preserved: string[] };

export async function uninstallPortable(config: SupervisorConfig, options: { purge?: boolean; confirmed?: boolean } = {}): Promise<UninstallResult> {
  const purge = options.purge === true;
  if (purge && !options.confirmed) throw new Error('Full uninstall deletes all Agenvyl user data; repeat with --purge --yes');
  await assertPortableBundle(config.bundleRoot);
  const dataRoots = uniquePaths([config.paths.config, config.paths.data]);
  validateTargets(config.bundleRoot, dataRoots, purge);
  await stopSupervisor(config);
  const shortcuts = await removeOwnedShortcuts(await loadSettings(config));
  if (purge) await purgeWindowsPostgresStorage(config);
  const removed = [config.bundleRoot, ...shortcuts, ...(purge ? dataRoots : [])];
  const preserved = purge ? [] : dataRoots;
  if (config.platform === 'win32') {
    await scheduleWindowsRemoval(config.bundleRoot, purge ? dataRoots : []);
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

async function scheduleWindowsRemoval(bundleRoot: string, dataRoots: string[]) {
  const cleanupRoot = await mkdtemp(join(tmpdir(), 'agenvyl-uninstall-'));
  const script = join(cleanupRoot, 'uninstall.cmd');
  await writeFile(script, windowsCleanupScript(dataRoots.length), 'utf8');
  const env: NodeJS.ProcessEnv = { ...process.env, AGENVYL_UNINSTALL_BUNDLE: bundleRoot };
  dataRoots.forEach((path, index) => { env[`AGENVYL_UNINSTALL_DATA_${index}`] = path; });
  const child = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/q', '/v:off', '/c', script], { cwd: tmpdir(), env, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

export function windowsCleanupScript(dataRootCount: number) {
  const removeData = Array.from({ length: dataRootCount }, (_, index) => `if defined AGENVYL_UNINSTALL_DATA_${index} rmdir /s /q "%AGENVYL_UNINSTALL_DATA_${index}%"`).join('\r\n');
  return `@echo off\r\nsetlocal\r\nfor /L %%I in (1,1,60) do (\r\n  rmdir /s /q "%AGENVYL_UNINSTALL_BUNDLE%" 2>nul\r\n  if not exist "%AGENVYL_UNINSTALL_BUNDLE%\\." goto removed\r\n  >nul 2>&1 ping 127.0.0.1 -n 2\r\n)\r\nexit /b 1\r\n:removed\r\n${removeData}${removeData ? '\r\n' : ''}del /q "%~f0" 2>nul\r\nrmdir /q "%~dp0" 2>nul\r\n`;
}
