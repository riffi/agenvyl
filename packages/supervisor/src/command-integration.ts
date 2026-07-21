import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { SupervisorConfig } from './config.js';
import { SupervisorError } from './errors.js';
import type { CommandRecord, SupervisorSettings } from './preferences.js';

const ownershipMarker = 'Agenvyl owned command';
const pathOwnershipMarker = 'Agenvyl owned PATH';

export async function installUserCommand(config: SupervisorConfig, previous?: SupervisorSettings): Promise<CommandRecord> {
  const existing = await readExisting(config.userCommandPath);
  const previouslyOwned = previous?.command?.path && resolve(previous.command.path) === resolve(config.userCommandPath);
  if (existing !== undefined && (!previouslyOwned || !existing.includes(ownershipMarker))) {
    throw new SupervisorError('COMMAND_EXISTS', `A command already exists and was not created by Agenvyl: ${config.userCommandPath}`, 'Remove it yourself or run init with --path none.');
  }

  await mkdir(dirname(config.userCommandPath), { recursive: true, mode: 0o700 });
  await writeFile(config.userCommandPath, commandShim(config), { mode: 0o755 });
  await chmod(config.userCommandPath, 0o755).catch(() => undefined);

  const previousPathOwnership = previous?.command?.pathEntry === config.userBinDirectory && previous.command.pathEntryAdded;
  const pathEntryAdded = config.platform === 'win32'
    ? ensureWindowsUserPath(config.userBinDirectory, previousPathOwnership === true)
    : await ensurePosixUserPath(config.userBinDirectory, config.userProfileFile, previousPathOwnership === true);
  return { path: config.userCommandPath, bundleRoot: config.bundleRoot, pathEntry: config.userBinDirectory, pathProfile: config.platform === 'win32' ? undefined : config.userProfileFile, pathEntryAdded };
}

export async function removeOwnedCommand(settings: SupervisorSettings | undefined, platform: SupervisorConfig['platform'], deferFileRemoval = false) {
  const record = settings?.command;
  if (!record) return { removed: [], deferredFiles: [] };
  const existing = await readExisting(record.path);
  const removed: string[] = [];
  const deferredFiles: string[] = [];
  if (existing?.includes(ownershipMarker) && existing.includes(record.bundleRoot)) {
    if (deferFileRemoval) deferredFiles.push(record.path);
    else await rm(record.path, { force: true });
    removed.push(record.path);
  }
  if (platform === 'win32' && record.pathEntry && record.pathEntryAdded) {
    removeWindowsUserPath(record.pathEntry);
    removed.push(`User PATH: ${record.pathEntry}`);
  }
  if (platform !== 'win32' && record.pathEntry && record.pathProfile && record.pathEntryAdded) {
    if (await removePosixUserPath(record.pathEntry, record.pathProfile)) removed.push(`User PATH profile: ${record.pathProfile}`);
  }
  return { removed, deferredFiles };
}

export function commandShim(config: SupervisorConfig) {
  if (config.platform === 'win32') return `@echo off\r\nrem ${ownershipMarker}\r\nrem Agenvyl bundle: ${config.bundleRoot}\r\ncall "${config.bundleRoot}\\bin\\agenvyl.cmd" %*\r\n`;
  return `#!/bin/sh\n# ${ownershipMarker}\n# Agenvyl bundle: ${config.bundleRoot}\nexec '${config.bundleRoot.replaceAll("'", "'\\''")}/bin/agenvyl' "$@"\n`;
}

function ensureWindowsUserPath(entry: string, alreadyOwned: boolean) {
  const entries = windowsUserPath('read');
  if (entries.some(value => normalized(value) === normalized(entry))) return alreadyOwned;
  windowsUserPath('add', entry);
  return true;
}

function removeWindowsUserPath(entry: string) { windowsUserPath('remove', entry); }

async function ensurePosixUserPath(entry: string, profile: string, alreadyOwned: boolean) {
  if ((process.env.PATH ?? '').split(':').some(value => normalized(value) === normalized(entry))) return alreadyOwned;
  const current = await readExisting(profile) ?? '';
  const ownedLine = posixPathLine(entry);
  if (current.includes(pathOwnershipMarker) && !alreadyOwned && !current.split(/\r?\n/u).includes(ownedLine)) {
    throw new SupervisorError('PATH_PROFILE_CONFLICT', `A PATH integration marker already exists in ${profile}.`, 'Remove the stale Agenvyl PATH line yourself and run repair.');
  }
  const withoutOwned = current.split(/\r?\n/u).filter(line => !line.includes(pathOwnershipMarker)).join('\n').replace(/\n+$/u, '');
  await mkdir(dirname(profile), { recursive: true, mode: 0o700 });
  await writeFile(profile, `${withoutOwned}${withoutOwned ? '\n' : ''}${ownedLine}\n`);
  return true;
}

async function removePosixUserPath(entry: string, profile: string) {
  const current = await readExisting(profile);
  if (current === undefined) return false;
  const ownedLine = posixPathLine(entry);
  if (!current.split(/\r?\n/u).includes(ownedLine)) return false;
  const next = current.split(/\r?\n/u).filter(line => line !== ownedLine).join('\n').replace(/\n+$/u, '');
  await writeFile(profile, next ? `${next}\n` : '');
  return true;
}

function posixPathLine(entry: string) { return `export PATH='${entry.replaceAll("'", "'\\''")}':"$PATH" # ${pathOwnershipMarker}`; }

function windowsUserPath(action: 'read' | 'add' | 'remove', entry?: string) {
  const script = action === 'read'
    ? "[Environment]::GetEnvironmentVariable('Path','User')"
    : action === 'add'
      ? "$p=[Environment]::GetEnvironmentVariable('Path','User');$e=$env:AGENVYL_PATH_ENTRY;$v=@($p -split ';' | ? { $_ })+$e;[Environment]::SetEnvironmentVariable('Path',($v -join ';'),'User')"
      : "$p=[Environment]::GetEnvironmentVariable('Path','User');$e=$env:AGENVYL_PATH_ENTRY;$v=@($p -split ';' | ? { $_ -and $_.TrimEnd('\\') -ine $e.TrimEnd('\\') });[Environment]::SetEnvironmentVariable('Path',($v -join ';'),'User')";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, env: { ...process.env, AGENVYL_PATH_ENTRY: entry ?? '' } });
  if (result.status !== 0) throw new SupervisorError('USER_PATH_UPDATE_FAILED', `Unable to ${action} the Windows User PATH.`, 'Update User PATH manually and run repair.', { stderr: result.stderr.trim() });
  return action === 'read' ? result.stdout.trim().split(';').filter(Boolean) : [];
}

function normalized(value: string) { return resolve(value).replace(/[\\/]+$/u, '').toLowerCase(); }
async function readExisting(path: string) { try { await stat(path); return readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; } }
