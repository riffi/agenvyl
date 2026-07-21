import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { open } from 'node:fs/promises';
import type { AgenvylPlatform } from '@agenvyl/runtime-config';

export async function spawnLogged(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; logFile: string },
) {
  const log = await open(options.logFile, 'a', 0o600);
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: false,
    stdio: ['ignore', log.fd, log.fd],
    windowsHide: true,
  });
  child.once('exit', () => void log.close());
  child.once('error', () => void log.close());
  await new Promise<void>((resolvePromise, reject) => {
    child.once('spawn', resolvePromise);
    child.once('error', reject);
  });
  return child;
}

export function isProcessAlive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function terminateChild(child: ChildProcess, platform: AgenvylPlatform, gracePeriodMs: number) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T'], { stdio: 'ignore', windowsHide: true });
  else child.kill('SIGTERM');
  await waitForExit(child, gracePeriodMs);
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else child.kill('SIGKILL');
  await waitForExit(child, Math.min(gracePeriodMs, 5_000));
}

export function terminateProcessTree(pid: number, platform: AgenvylPlatform, force = true) {
  if (!isProcessAlive(pid)) return;
  if (platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM'); } catch {
    try { process.kill(pid, force ? 'SIGKILL' : 'SIGTERM'); } catch { /* already stopped */ }
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return Promise.race([
    new Promise<void>(resolvePromise => child.once('exit', () => resolvePromise())),
    new Promise<void>(resolvePromise => setTimeout(resolvePromise, timeoutMs)),
  ]);
}
