import {randomUUID} from 'node:crypto';
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
export type SettingsInspection = { status: 'missing' } | { status: 'valid'; settings: SupervisorSettings } | { status: 'invalid'; cause: string };

export async function loadSettings(config: SupervisorConfig): Promise<SupervisorSettings | undefined> {
  const inspection=await inspectSettings(config);
  if(inspection.status==='missing')return undefined;
  if(inspection.status==='valid')return inspection.settings;
  throw invalidSettingsError(inspection.cause);
}

export async function inspectSettings(config:SupervisorConfig):Promise<SettingsInspection>{
  let value:unknown;
  try{value=JSON.parse(await readFile(config.settingsFile,'utf8'));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return{status:'missing'};return{status:'invalid',cause:message(error)};}
  if(!value||typeof value!=='object')return{status:'invalid',cause:'unsupported or malformed settings'};
  const candidate=value as {schemaVersion?:number;locale?:unknown;initializedAt?:unknown;shortcuts?:unknown;command?:unknown};
  if((candidate.schemaVersion!==1&&candidate.schemaVersion!==2)||!isLocale(candidate.locale)||typeof candidate.initializedAt!=='string'||!Array.isArray(candidate.shortcuts))return{status:'invalid',cause:'unsupported or malformed settings'};
  if(candidate.schemaVersion===2&&candidate.command!==undefined&&!isCommandRecord(candidate.command))return{status:'invalid',cause:'unsupported or malformed command integration'};
  return{status:'valid',settings:{schemaVersion:2,locale:candidate.locale,initializedAt:candidate.initializedAt,shortcuts:candidate.shortcuts,command:candidate.schemaVersion===2?candidate.command:undefined} as SupervisorSettings};
}

export async function archiveInvalidSettings(config:SupervisorConfig){
  const inspection=await inspectSettings(config);if(inspection.status!=='invalid')return undefined;
  const stamp=new Date().toISOString().replace(/[:.]/gu,'-');
  const backup=`${config.settingsFile}.invalid-${stamp}-${randomUUID()}.json`;
  try{await rename(config.settingsFile,backup);return backup;}
  catch(error){throw new SupervisorError('SETTINGS_BACKUP_FAILED','Unable to archive damaged Agenvyl settings.','Move the settings file manually and retry repair.',{cause:message(error)});}
}

export function invalidSettingsError(cause:string){return new SupervisorError('SETTINGS_INVALID','Agenvyl settings are damaged.','Run agenvyl repair.',{cause});}

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
