import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SupervisorConfig } from './config.js';
import { SupervisorError } from './errors.js';
import { archiveInvalidSettings, inspectSettings, loadSettings, saveSettings, type Locale } from './preferences.js';
import { initializePortableRuntime } from './runtime.js';
import { createShortcuts, type ShortcutPolicy } from './shortcuts.js';
import { installUserCommand } from './command-integration.js';

export type PathPolicy = 'none' | 'user';
export type InitializationResult = { initialized: true; repaired: boolean; locale: Locale; shortcuts: string[]; command?: string; settingsFile: string };

export async function initializePortable(config: SupervisorConfig, options: { locale: Locale; shortcuts: ShortcutPolicy; path?: PathPolicy; recoverOwnedIntegrations?: boolean }): Promise<InitializationResult> {
  await validateManifest(config);
  const previous = await loadSettings(config);
  const installedBefore = await isPortableInitialized(config);
  await initializePortableRuntime(config);
  const shortcuts = await createShortcuts(config, options.shortcuts, previous, { recognizeOwned: options.recoverOwnedIntegrations });
  const command = options.path === 'user' || (previous?.command !== undefined && previous.command.bundleRoot !== config.bundleRoot)
    ? await installUserCommand(config, previous, { recognizeOwned: options.recoverOwnedIntegrations })
    : previous?.command;
  const settings = {
    schemaVersion: 2 as const,
    locale: options.locale,
    initializedAt: previous?.initializedAt ?? new Date().toISOString(),
    shortcuts,
    command,
  };
  await saveSettings(config, settings);
  return { initialized: true, repaired: installedBefore, locale: settings.locale, shortcuts: shortcuts.map(item => item.path), command: command?.path, settingsFile: config.settingsFile };
}

export type RepairResult=InitializationResult&{settingsBackup?:string};
export async function repairPortable(config:SupervisorConfig,options:{locale:Locale;shortcuts:ShortcutPolicy;path?:PathPolicy}):Promise<RepairResult>{
  await validateManifest(config);
  const inspection=await inspectSettings(config);
  const settingsBackup=inspection.status==='invalid'?await archiveInvalidSettings(config):undefined;
  const result=await initializePortable(config,{...options,recoverOwnedIntegrations:true});
  return{...result,...(settingsBackup?{settingsBackup}:{})};
}

export async function isPortableInitialized(config: SupervisorConfig) {
  return exists(config.secretsFile) || exists(join(config.paths.postgres, 'PG_VERSION'));
}

export async function validateManifest(config: SupervisorConfig) {
  const path = join(config.bundleRoot, 'manifest.json');
  let manifest: { name?: string; platform?: string; architecture?: string };
  try { manifest = JSON.parse(await readFile(path, 'utf8')) as typeof manifest; }
  catch (error) { throw new SupervisorError('BUNDLE_INVALID', `Portable manifest is unavailable: ${path}`, 'Run Agenvyl from the extracted portable bundle.', { cause: message(error) }); }
  if (manifest.name !== 'agenvyl-portable-runtime' || manifest.platform !== config.platform || manifest.architecture !== process.arch) {
    throw new SupervisorError('BUNDLE_TARGET_MISMATCH', 'This portable bundle does not match the current computer.', 'Download the Agenvyl bundle for this platform and architecture.', { manifest });
  }
}
async function exists(path: string) { try { await stat(path); return true; } catch { return false; } }
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
