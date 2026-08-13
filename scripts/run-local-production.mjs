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

const exists = async path => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const prepareLocalFiles = async () => {
  await mkdir(workspaceRoot, { recursive: true });
  if (await exists(connectorConfig)) return;
  await copyFile(join(repositoryRoot, 'connector.example.yaml'), connectorConfig);
  process.stdout.write(`[serve] Created ${connectorConfig}\n`);
};

const fail = message => {
  process.stderr.write(`[serve] ${message}\n`);
  process.exit(1);
};

const runRequired = (command, args, env, label, shell = false) => {
  process.stdout.write(`[serve] Preparing ${label}...\n`);
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env,
    stdio: 'inherit',
    windowsHide: true,
    shell,
  });
  if (result.error) fail(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} preparation failed with status ${result.status}`);
};

const startProcess = (label, entrypoint, env) => {
  const child = spawn(process.execPath, [entrypoint], {
    cwd: repositoryRoot,
    env,
    detached: process.platform !== 'win32',
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.label = label;
  createInterface({ input: child.stdout }).on('line', line => process.stdout.write(`[${label}] ${line}\n`));
  createInterface({ input: child.stderr }).on('line', line => process.stderr.write(`[${label}] ${line}\n`));
  child.once('error', error => process.stderr.write(`[${label}] ${error.message}\n`));
  return child;
};

const terminateProcessTree = child => {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
};

const npmCommand = () => process.platform === 'win32' ? join(dirname(process.execPath), 'npm.cmd') : 'npm';

await prepareLocalFiles();
runRequired('docker', ['compose', 'up', '-d', '--wait', 'postgres'], sharedEnvironment, 'PostgreSQL');
runRequired(npmCommand(), ['run', 'build'], sharedEnvironment, 'production build', process.platform === 'win32');

const processes = [
  startProcess('connector', 'apps/connector/dist/index.js', sharedEnvironment),
  startProcess('backend', 'apps/backend/dist/index.js', {
    ...sharedEnvironment,
    AGENVYL_CONNECTOR_URL: 'http://127.0.0.1:4310',
    AGENVYL_DATABASE_URL: `postgres://agenvyl:${encodeURIComponent(postgresPassword)}@127.0.0.1:${postgresPort}/agenvyl`,
    AGENVYL_SERVE_STATIC_FRONTEND: 'true',
  }),
];

process.stdout.write('\nAgenvyl production build is starting. Open http://127.0.0.1:8791.\n');
process.stdout.write('Press Ctrl+C to stop Core and Connector. PostgreSQL stays running.\n\n');

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
      process.stderr.write(`\n[serve] ${child.label} stopped unexpectedly (${code ?? 'signal'}). Stopping the other process.\n`);
      stop(code || 1);
    }
    if (remaining === 0) resolveExit();
  });
});
