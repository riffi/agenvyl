import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { SupervisorConfig } from './config.js';
import { SupervisorError } from './errors.js';
import type { ShortcutRecord, SupervisorSettings } from './preferences.js';

export type ShortcutPolicy = 'none' | 'recommended' | 'all';

export async function createShortcuts(config: SupervisorConfig, policy: ShortcutPolicy, previous: SupervisorSettings | undefined): Promise<ShortcutRecord[]> {
  if (policy === 'none') return previous?.shortcuts ?? [];
  const records = desired(config, policy);
  for (const record of records) {
    const owned = previous?.shortcuts.some(item => resolve(item.path) === resolve(record.path)) === true;
    if (await exists(record.path) && !owned) throw new SupervisorError('SHORTCUT_EXISTS', `A shortcut already exists and was not created by Agenvyl: ${record.path}`, 'Choose another shortcut policy or remove the file yourself.');
    await mkdir(dirname(record.path), { recursive: true });
    await writeFile(record.path, content(config), { mode: 0o755 });
    await chmod(record.path, 0o755).catch(() => undefined);
  }
  return records;
}

export async function removeOwnedShortcuts(settings: SupervisorSettings | undefined): Promise<string[]> {
  const removed: string[] = [];
  for (const shortcut of settings?.shortcuts ?? []) {
    if (!await belongsToBundle(shortcut)) continue;
    await rm(shortcut.path, { force: true });
    removed.push(shortcut.path);
  }
  return removed;
}

function desired(config: SupervisorConfig, policy: ShortcutPolicy): ShortcutRecord[] {
  const desktop = join(homedir(), 'Desktop');
  if (config.platform === 'win32') {
    const startMenu = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Agenvyl.cmd');
    return records(config, [{ kind: 'start-menu', path: startMenu }, ...(policy === 'all' ? [{ kind: 'desktop' as const, path: join(desktop, 'Agenvyl.cmd') }] : [])]);
  }
  if (config.platform === 'darwin') return records(config, [{ kind: 'applications', path: join(homedir(), 'Applications', 'Agenvyl.command') }, ...(policy === 'all' ? [{ kind: 'desktop' as const, path: join(desktop, 'Agenvyl.command') }] : [])]);
  return records(config, [{ kind: 'application-menu', path: join(homedir(), '.local', 'share', 'applications', 'agenvyl.desktop') }, ...(policy === 'all' ? [{ kind: 'desktop' as const, path: join(desktop, 'Agenvyl.desktop') }] : [])]);
}

function records(config: SupervisorConfig, values: Array<{ kind: ShortcutRecord['kind']; path: string }>): ShortcutRecord[] {
  return values.map(value => ({ ...value, bundleRoot: config.bundleRoot }));
}

function content(config: SupervisorConfig) {
  if (config.platform === 'win32') return `@echo off\r\nrem Agenvyl bundle: ${config.bundleRoot}\r\ncall "${join(config.bundleRoot, 'Agenvyl.cmd')}"\r\n`;
  if (config.platform === 'linux') return `[Desktop Entry]\nType=Application\nName=Agenvyl\nComment=Agenvyl control center\nExec=${desktopQuote(join(config.bundleRoot, 'Agenvyl.sh'))}\nTerminal=true\nCategories=Development;\nX-Agenvyl-Bundle=${config.bundleRoot}\n`;
  return `#!/bin/sh\n# Agenvyl bundle: ${config.bundleRoot}\nexec ${shellQuote(join(config.bundleRoot, 'Agenvyl.command'))}\n`;
}

async function belongsToBundle(shortcut: ShortcutRecord) {
  try { return (await readFile(shortcut.path, 'utf8')).includes(shortcut.bundleRoot); }
  catch { return false; }
}
function shellQuote(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }
function desktopQuote(value: string) { return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`; }
async function exists(path: string) { try { await stat(path); return true; } catch { return false; } }
