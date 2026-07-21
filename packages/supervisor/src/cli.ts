#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupDatabase, doctor, getSupervisorStatus, readLogs, restoreDatabase, runSupervisorDaemon, startSupervisor, stopSupervisor } from './runtime.js';
import { resolveSupervisorConfig } from './config.js';

const [command = 'status', ...args] = process.argv.slice(2);
const json = args.includes('--json');

try {
  const config = resolveSupervisorConfig();
  if (command === 'daemon') await runSupervisorDaemon(config);
  else if (command === 'start') output(await startSupervisor(config, fileURLToPath(import.meta.url)), json);
  else if (command === 'stop') output(await stopSupervisor(config), json);
  else if (command === 'status') {
    const status = await getSupervisorStatus(config);
    output(status, json);
    if (!status.running) process.exitCode = 3;
  } else if (command === 'logs') {
    const component = args[0] && !args[0].startsWith('--') ? args[0] : 'supervisor';
    const linesIndex = args.indexOf('--lines');
    process.stdout.write(await readLogs(config, component, linesIndex >= 0 ? Number(args[linesIndex + 1]) : 100));
  } else if (command === 'doctor') {
    const result = await doctor(config);
    output(result, json);
    if (!result.ok) process.exitCode = 2;
  } else if (command === 'backup') output({ backup: await backupDatabase(config, positional(args, 0)) }, json);
  else if (command === 'restore') {
    const archive = positional(args, 0);
    if (!archive) throw new Error('Usage: agenvyl restore <file>');
    output({ restored: await restoreDatabase(config, resolve(archive)) }, json);
  } else throw new Error('Usage: agenvyl <start|stop|status|logs|doctor|backup|restore>');
} catch (error) {
  process.stderr.write(`agenvyl: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function positional(values: string[], index: number) { return values.filter(value => !value.startsWith('--'))[index]; }
function output(value: unknown, asJson: boolean) {
  if (asJson) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else if (typeof value === 'string') process.stdout.write(`${value}\n`);
  else process.stdout.write(`${format(value)}\n`);
}
function format(value: unknown) {
  if (value && typeof value === 'object' && 'checks' in value) return (value as { checks: { ok: boolean; name: string; detail: string }[] }).checks.map(check => `${check.ok ? 'ok' : 'FAIL'}  ${check.name}: ${check.detail}`).join('\n');
  if (value && typeof value === 'object' && 'running' in value) {
    const status = value as { running: boolean; stale: boolean; state?: { phase: string; daemonPid: number } };
    return status.running ? `Agenvyl is running (PID ${status.state?.daemonPid})` : status.stale ? 'Agenvyl has stale runtime state' : 'Agenvyl is stopped';
  }
  return JSON.stringify(value, null, 2);
}
