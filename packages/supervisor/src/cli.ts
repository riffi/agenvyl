#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupDatabase, doctor, getSupervisorStatus, readLogs, restoreDatabase, runSupervisorDaemon, startSupervisor, stopSupervisor } from './runtime.js';
import { resolveSupervisorConfig } from './config.js';
import { runSetup } from './setup.js';
import { uninstallPortable } from './uninstall.js';
import { initializePortable } from './initialization.js';
import { defaultLocale, isLocale, loadSettings, type Locale } from './preferences.js';
import type { ShortcutPolicy } from './shortcuts.js';
import { errorEnvelope, SupervisorError } from './errors.js';
import { runTui } from './tui.js';

const argv = process.argv.slice(2);
const explicitCommand = argv[0] && !argv[0].startsWith('--') ? argv[0] : undefined;
const command = explicitCommand ?? (process.stdin.isTTY && process.stdout.isTTY ? 'tui' : 'status');
const args = explicitCommand ? argv.slice(1) : argv;
const json = args.includes('--json');

try {
  const config = resolveSupervisorConfig();
  const locale = (await loadSettings(config))?.locale ?? defaultLocale();
  if (command === 'daemon') await runSupervisorDaemon(config);
  else if (command === 'tui') await runTui(config, fileURLToPath(import.meta.url));
  else if (command === 'init') {
    const selectedLocale = option(args, '--locale') ?? locale;
    const shortcuts = option(args, '--shortcuts') ?? 'recommended';
    if (!isLocale(selectedLocale)) throw new SupervisorError('INVALID_LOCALE', '--locale must be ru or en');
    if (!isShortcutPolicy(shortcuts)) throw new SupervisorError('INVALID_SHORTCUT_POLICY', '--shortcuts must be none, recommended, or all');
    output(await initializePortable(config, { locale: selectedLocale, shortcuts }), json, selectedLocale);
  } else if (command === 'setup') output(await runSetup(config, fileURLToPath(import.meta.url), { all: args.includes('--all'), openBrowser: !args.includes('--no-open') }), json, locale);
  else if (command === 'start') output(await startSupervisor(config, fileURLToPath(import.meta.url)), json, locale);
  else if (command === 'stop') output(await stopSupervisor(config), json, locale);
  else if (command === 'status') {
    const status = await getSupervisorStatus(config); output(status, json, locale); if (!status.running) process.exitCode = 3;
  } else if (command === 'logs') {
    const component = positional(args, 0) ?? 'supervisor';
    const lines = Number(option(args, '--lines') ?? 100);
    process.stdout.write(await readLogs(config, component, lines));
  } else if (command === 'doctor') {
    const result = await doctor(config); output(result, json, locale); if (!result.ok) process.exitCode = 2;
  } else if (command === 'backup') output({ backup: await backupDatabase(config, positional(args, 0)) }, json, locale);
  else if (command === 'restore') {
    const archive = positional(args, 0); if (!archive) throw new SupervisorError('RESTORE_FILE_REQUIRED', 'Usage: agenvyl restore <file>');
    output({ restored: await restoreDatabase(config, resolve(archive)) }, json, locale);
  } else if (command === 'uninstall') output(await uninstallPortable(config, { purge: args.includes('--purge'), confirmed: args.includes('--yes') }), json, locale);
  else throw new SupervisorError('UNKNOWN_COMMAND', 'Usage: agenvyl <tui|init|setup|start|stop|status|logs|doctor|backup|restore|uninstall>');
} catch (error) {
  if (json) process.stderr.write(`${JSON.stringify(errorEnvelope(error), null, 2)}\n`);
  else process.stderr.write(`agenvyl: ${humanError(error)}\n`);
  process.exitCode = 1;
}

function positional(values: string[], index: number) {
  const result: string[] = [];
  for (let cursor = 0; cursor < values.length; cursor += 1) {
    if (values[cursor].startsWith('--')) { if (!['--json', '--all', '--no-open', '--purge', '--yes'].includes(values[cursor])) cursor += 1; continue; }
    result.push(values[cursor]);
  }
  return result[index];
}
function option(values: string[], name: string) { const index = values.indexOf(name); return index < 0 ? undefined : values[index + 1]; }
function isShortcutPolicy(value: string): value is ShortcutPolicy { return value === 'none' || value === 'recommended' || value === 'all'; }
function output(value: unknown, asJson: boolean, locale: Locale) {
  if (asJson) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else if (typeof value === 'string') process.stdout.write(`${value}\n`);
  else process.stdout.write(`${format(value, locale)}\n`);
}
function format(value: unknown, locale: Locale) {
  if (value && typeof value === 'object' && 'checks' in value) return (value as { checks: { ok: boolean; name: string; detail: string }[] }).checks.map(check => `${check.ok ? 'ok' : 'FAIL'}  ${check.name}: ${check.detail}`).join('\n');
  if (value && typeof value === 'object' && 'running' in value) {
    const status = value as { running: boolean; stale: boolean; state?: { phase: string; daemonPid: number } };
    if (locale === 'ru') return status.running ? 'Agenvyl работает' : status.stale ? 'Agenvyl требует внимания: найдено устаревшее состояние' : 'Agenvyl остановлен';
    return status.running ? `Agenvyl is running (PID ${status.state?.daemonPid})` : status.stale ? 'Agenvyl has stale runtime state' : 'Agenvyl is stopped';
  }
  if (value && typeof value === 'object' && 'initialized' in value) return locale === 'ru' ? 'Agenvyl установлен и готов к запуску' : 'Agenvyl is installed and ready to start';
  return JSON.stringify(value, null, 2);
}
function humanError(error: unknown) {
  if (error instanceof SupervisorError) return `${error.message}${error.action ? `\nNext: ${error.action}` : ''}`;
  return error instanceof Error ? error.message : String(error);
}
