import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const connectorConfig = join(repositoryRoot, 'connector.yaml');
const workspaceRoot = join(repositoryRoot, 'data', 'room-workspaces');
const token = process.env.AGENVYL_CONNECTOR_TOKEN?.trim() || randomBytes(32).toString('hex');
const postgresPassword = process.env.POSTGRES_PASSWORD?.trim() || 'agenvyl';
const postgresPort = process.env.AGENVYL_POSTGRES_PORT?.trim() || '55432';
const sharedEnvironment = {
  ...process.env,
  POSTGRES_PASSWORD: postgresPassword,
  AGENVYL_POSTGRES_PORT: postgresPort,
  AGENVYL_CONNECTOR_TOKEN: token,
  AGENVYL_CONNECTOR_CONFIG: connectorConfig,
  AGENVYL_WORKSPACE_ROOT: workspaceRoot,
};

const prepareDevelopmentFiles = async () => {
  await mkdir(workspaceRoot, { recursive: true });
  if (await exists(connectorConfig)) return;
  await copyFile(join(repositoryRoot, 'connector.example.yaml'), connectorConfig);
  process.stdout.write(`[dev] Created ${connectorConfig}\n`);
};

await prepareDevelopmentFiles();
runRequired('docker', ['compose', 'up', '-d', '--wait', 'postgres'], sharedEnvironment, 'PostgreSQL');
runRequired(npmCommand(), ['run', 'build:contracts'], sharedEnvironment, 'TypeScript contracts', process.platform === 'win32');

const processes = [
  startProcess('connector', process.execPath, [localBinary('tsx', 'dist/cli.mjs'), 'watch', 'apps/connector/src/index.ts'], sharedEnvironment),
  startProcess('backend', process.execPath, [localBinary('tsx', 'dist/cli.mjs'), 'watch', 'apps/backend/src/index.ts'], {
    ...sharedEnvironment,
    AGENVYL_CONNECTOR_URL: 'http://127.0.0.1:4310',
    AGENVYL_DATABASE_URL: `postgres://agenvyl:${encodeURIComponent(postgresPassword)}@127.0.0.1:${postgresPort}/agenvyl`,
  }),
  startProcess('frontend', process.execPath, [localBinary('vite', 'bin/vite.js'), '--config', 'apps/frontend/vite.config.ts'], {
    ...sharedEnvironment,
    DEV_BACKEND_URL: 'http://127.0.0.1:8791',
  }),
];

process.stdout.write('\nAgenvyl development is starting. Open the Vite URL shown below.\n');
process.stdout.write('Press Ctrl+C to stop frontend, backend, and Connector. PostgreSQL stays running.\n\n');

let stopping = false;
const stop = (exitCode = 0) => {
  if (stopping) return;
  stopping = true;
  for (const child of processes) terminateProcessTree(child);
  process.exitCode = exitCode;
};

process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));

await new Promise(resolveExit => {
  let remaining = processes.length;
  for (const child of processes) child.once('exit', code => {
    remaining -= 1;
    if (!stopping) {
      process.stderr.write(`\n[dev] ${child.label} stopped unexpectedly (${code ?? 'signal'}). Stopping the other processes.\n`);
      stop(code || 1);
    }
    if (remaining === 0) resolveExit();
  });
});

function startProcess(label, command, args, env) {
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    env,
    detached: process.platform !== 'win32',
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.label = label;
  prefixOutput(child.stdout, label, process.stdout);
  prefixOutput(child.stderr, label, process.stderr);
  child.once('error', error => process.stderr.write(`[${label}] ${error.message}\n`));
  return child;
}

function prefixOutput(stream, label, destination) {
  if (!stream) return;
  createInterface({ input: stream }).on('line', line => destination.write(`[${label}] ${line}\n`));
}

function terminateProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
}

function runRequired(command, args, env, label, shell = false) {
  process.stdout.write(`[dev] Preparing ${label}...\n`);
  const result = spawnSync(command, args, { cwd: repositoryRoot, env, stdio: 'inherit', windowsHide: true, shell });
  if (result.error) fail(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} preparation failed with status ${result.status}`);
}

function npmCommand() { return process.platform === 'win32' ? join(dirname(process.execPath), 'npm.cmd') : 'npm'; }
function localBinary(packageName, relativePath) { return join(repositoryRoot, 'node_modules', packageName, relativePath); }
async function exists(path) { try { await stat(path); return true; } catch { return false; } }
function fail(message) { process.stderr.write(`[dev] ${message}\n`); process.exit(1); }
