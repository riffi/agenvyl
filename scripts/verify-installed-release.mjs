import { spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, resolve } from 'node:path';

if (!process.argv[2]) throw new Error('Usage: node scripts/verify-installed-release.mjs <agenvyl-command>');
const command = resolve(process.argv[2]);
const ports = [process.env.AGENVYL_PORT, process.env.AGENVYL_CONNECTOR_PORT, process.env.AGENVYL_POSTGRES_PORT].map(Number);
if (ports.some(port => !Number.isSafeInteger(port))) throw new Error('Release smoke requires explicit Agenvyl ports');

const doctor = runJson(['doctor', '--json']);
if (!doctor.ok) throw new Error(`Installed release doctor failed: ${JSON.stringify(doctor)}`);
const started = runJson(['start', '--json']);
if (started.phase !== 'running') throw new Error(`Installed release did not start: ${JSON.stringify(started)}`);
await waitForHttp(`http://127.0.0.1:${ports[0]}/api/v1/health`);
const frontend = await fetch(`http://127.0.0.1:${ports[0]}/`, { signal: AbortSignal.timeout(2_000) });
if (!frontend.ok || !(await frontend.text()).includes('<!doctype html>')) throw new Error('Installed release did not serve the Web UI');
const status = runJson(['status', '--json']);
if (!status.running || status.state?.phase !== 'running') throw new Error(`Installed release status is not running: ${JSON.stringify(status)}`);

const pids = [status.state.daemonPid, ...Object.values(status.state.components).map(component => component.pid)];
runJson(['stop', '--json']);
await waitFor(() => pids.every(pid => !processAlive(pid)), 30_000);
for (const port of ports) if (!(await portAvailable(port))) throw new Error(`Installed release did not release port ${port}`);
const removed = runJson(['uninstall', '--json']);
if (removed.purge) throw new Error('Release smoke unexpectedly purged user data');
const uninstallTimeoutMs = process.platform === 'win32' ? 75_000 : 30_000;
await waitFor(async () => !await exists(command), uninstallTimeoutMs);
console.log(`Installed release verified on ${process.platform}-${process.arch}: download, init, PATH command, lifecycle, Web UI, stop, and uninstall.`);

function runJson(args) {
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'call', command, ...args], { encoding: 'utf8', env: process.env, windowsHide: true, timeout: 300_000 })
    : spawnSync(command, args, { encoding: 'utf8', env: process.env, timeout: 300_000 });
  if (result.status !== 0) throw new Error(`${basename(command)} ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

async function waitForHttp(url) {
  await waitFor(async () => {
    try {
      return (await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok;
    } catch {
      return false;
    }
  }, 60_000);
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function portAvailable(port) {
  return new Promise(resolveAvailable => {
    const server = createServer();
    server.once('error', () => resolveAvailable(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolveAvailable(true)));
  });
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
