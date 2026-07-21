import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SupervisorConfig } from './config.js';
import { SupervisorError } from './errors.js';

export type Locale = 'ru' | 'en';
export type ShortcutKind = 'start-menu' | 'application-menu' | 'applications' | 'desktop';
export type ShortcutRecord = { kind: ShortcutKind; path: string; bundleRoot: string };
export type CommandRecord = { path: string; bundleRoot: string; pathEntry?: string; pathProfile?: string; pathEntryAdded: boolean };
export type SupervisorSettings = {
  schemaVersion: 2;
  locale: Locale;
  initializedAt: string;
  shortcuts: ShortcutRecord[];
  command?: CommandRecord;
};

export async function loadSettings(config: SupervisorConfig): Promise<SupervisorSettings | undefined> {
  try {
    const value = JSON.parse(await readFile(config.settingsFile, 'utf8')) as { schemaVersion?: number; locale?: unknown; initializedAt?: unknown; shortcuts?: unknown; command?: unknown };
    if ((value.schemaVersion !== 1 && value.schemaVersion !== 2) || !isLocale(value.locale) || typeof value.initializedAt !== 'string' || !Array.isArray(value.shortcuts)) {
      throw new Error('unsupported or malformed settings');
    }
    if (value.schemaVersion === 2 && value.command !== undefined && !isCommandRecord(value.command)) throw new Error('unsupported or malformed command integration');
    return { schemaVersion: 2, locale: value.locale, initializedAt: value.initializedAt, shortcuts: value.shortcuts, command: value.schemaVersion === 2 ? value.command : undefined } as SupervisorSettings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new SupervisorError('SETTINGS_INVALID', 'Agenvyl settings are damaged.', 'Run repair from the dashboard.', { cause: message(error) });
  }
}

export async function saveSettings(config: SupervisorConfig, settings: SupervisorSettings) {
  await mkdir(dirname(config.settingsFile), { recursive: true, mode: 0o700 });
  const temporary = `${config.settingsFile}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  if (config.platform === 'win32' && await exists(config.settingsFile)) {
    const previous = `${config.settingsFile}.previous`;
    await rm(previous, { force: true });
    await rename(config.settingsFile, previous).catch(() => undefined);
    await rename(temporary, config.settingsFile);
    await rm(previous, { force: true });
  } else await rename(temporary, config.settingsFile);
  await chmod(config.settingsFile, 0o600).catch(() => undefined);
}

export function defaultLocale(env = process.env): Locale {
  return /^(ru|rus)([_-]|$)/i.test(env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG ?? '') ? 'ru' : 'en';
}

export function isLocale(value: unknown): value is Locale { return value === 'ru' || value === 'en'; }
function isCommandRecord(value: unknown): value is CommandRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<CommandRecord>;
  return typeof record.path === 'string' && typeof record.bundleRoot === 'string' && typeof record.pathEntryAdded === 'boolean' && (record.pathEntry === undefined || typeof record.pathEntry === 'string') && (record.pathProfile === undefined || typeof record.pathProfile === 'string');
}
async function exists(path: string) { try { await stat(path); return true; } catch { return false; } }
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
