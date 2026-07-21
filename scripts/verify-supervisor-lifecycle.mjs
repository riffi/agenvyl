import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const archive = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: node scripts/verify-supervisor-lifecycle.mjs <postgres-artifact.tar.gz>');
const repositoryRoot = resolve(import.meta.dirname, '..');
const cli = join(repositoryRoot, 'packages/supervisor/dist/cli.js');
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const temporaryRoot = await mkdtemp(join(tmpdir(), 'agenvyl supervisor ü '));
const appRoot = join(temporaryRoot, 'app fixture');
const userRoot = join(temporaryRoot, 'user data');
const artifactName = basename(archive, '.tar.gz');
const postgresRoot = join(temporaryRoot, artifactName, 'postgres');
const [corePort, connectorPort, postgresPort] = await distinctPorts(3);
const executable = name => join(postgresRoot, 'bin', process.platform === 'win32' ? `${name}.exe` : name);
const env = {
  ...process.env,
  AGENVYL_BUNDLE_ROOT: temporaryRoot,
  AGENVYL_HOME: userRoot,
  AGENVYL_APP_ROOT: appRoot,
  AGENVYL_NODE_EXECUTABLE: process.execPath,
  AGENVYL_CORE_ENTRYPOINT: join(appRoot, 'core.mjs'),
  AGENVYL_CONNECTOR_ENTRYPOINT: join(appRoot, 'connector.mjs'),
  AGENVYL_POSTGRES_ROOT: postgresRoot,
  AGENVYL_PORT: String(corePort),
  AGENVYL_CONNECTOR_PORT: String(connectorPort),
  AGENVYL_POSTGRES_PORT: String(postgresPort),
  AGENVYL_READINESS_TIMEOUT_MS: '30000',
  AGENVYL_SHUTDOWN_TIMEOUT_MS: '10000',
  ...(process.platform === 'win32'
    ? { LOCALAPPDATA: userRoot }
    : { XDG_CONFIG_HOME: join(userRoot, 'config'), XDG_DATA_HOME: join(userRoot, 'data') }),
};

try {
  run(tar, ['-xzf', archive, '-C', temporaryRoot]);
  await mkdir(appRoot, { recursive: true });
  await writeFixture(join(appRoot, 'connector.mjs'), connectorFixture());
  await writeFixture(join(appRoot, 'core.mjs'), coreFixture());

  const preflight = cliJson(['doctor', '--json'], false);
  if (!preflight.ok) throw new Error(`Supervisor doctor failed: ${JSON.stringify(preflight)}`);

  cliJson(['start', '--json']);
  const first = cliJson(['status', '--json']);
  if (!first.running || first.state?.phase !== 'running') throw new Error('Supervisor did not reach running state');

  const databaseUrl = await managedDatabaseUrl();
  run(executable('psql'), ['--dbname', databaseUrl, '-v', 'ON_ERROR_STOP=1', '-c', "CREATE TABLE probe(value text NOT NULL); INSERT INTO probe VALUES ('portable-data-ok');"], undefined, postgresEnvironment());
  const backup = cliJson(['backup', '--json']).backup;
  run(executable('psql'), ['--dbname', databaseUrl, '-v', 'ON_ERROR_STOP=1', '-c', "UPDATE probe SET value='mutated';"], undefined, postgresEnvironment());
  cliJson(['stop', '--json']);
  cliJson(['restore', backup, '--json']);
  cliJson(['start', '--json']);
  const restored = capture(executable('psql'), ['--dbname', databaseUrl, '-At', '-c', 'SELECT value FROM probe'], postgresEnvironment()).trim();
  if (restored !== 'portable-data-ok') throw new Error(`Backup restore returned unexpected data: ${restored}`);

  const idempotent = cliJson(['start', '--json']);
  const beforeCrash = cliJson(['status', '--json']);
  if (idempotent.daemonPid !== beforeCrash.state.daemonPid) throw new Error('Idempotent start replaced the running daemon');
  terminateTree(beforeCrash.state.daemonPid);
  await waitFor(() => !processAlive(beforeCrash.state.daemonPid), 15000);
  cliJson(['start', '--json']);
  const afterCrash = cliJson(['status', '--json']);
  if (!afterCrash.running || afterCrash.state.daemonPid === beforeCrash.state.daemonPid) throw new Error('Stale PID recovery did not create a new daemon');
  cliJson(['stop', '--json']);

  const blocker = createServer();
  await new Promise((resolvePromise, reject) => blocker.once('error', reject).listen(corePort, '127.0.0.1', resolvePromise));
  const conflict = cliJson(['doctor', '--json'], false);
  await new Promise(resolvePromise => blocker.close(resolvePromise));
  if (conflict.ok || !conflict.checks.some(check => check.detail.includes('already in use'))) throw new Error('Port conflict was not diagnosed');

  const logs = runCli(['logs', 'supervisor', '--lines', '20'], true);
  if (!logs.stdout && !logs.stderr) throw new Error('Supervisor logs were empty');
  const stopped = cliJson(['status', '--json'], false);
  if (stopped.running || stopped.state) throw new Error('Supervisor left runtime state after stop');
  console.log(`Supervisor lifecycle verified: ${process.platform}-${process.arch}`);
} finally {
  try { cliJson(['stop', '--json'], false); } catch { /* best-effort exact cleanup */ }
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function managedDatabaseUrl() {
  const configRoot = process.platform === 'win32'
    ? join(userRoot, 'Agenvyl')
    : process.platform === 'darwin'
      ? join(userRoot, 'Library', 'Application Support', 'Agenvyl')
      : join(userRoot, 'config', 'agenvyl');
  const secrets = JSON.parse(await readFile(join(configRoot, 'secrets.json'), 'utf8'));
  return `postgresql://agenvyl:${encodeURIComponent(secrets.postgresPassword)}@127.0.0.1:${postgresPort}/agenvyl`;
}
function postgresEnvironment() {
  const bin = join(postgresRoot, 'bin'), lib = join(postgresRoot, 'lib');
  return { ...env, PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${env.PATH ?? ''}`, ...(process.platform === 'linux' ? { LD_LIBRARY_PATH: `${lib}:${env.LD_LIBRARY_PATH ?? ''}` } : {}), ...(process.platform === 'darwin' ? { DYLD_LIBRARY_PATH: `${lib}:${env.DYLD_LIBRARY_PATH ?? ''}` } : {}) };
}
function cliJson(args, requireSuccess = true) {
  const result = runCli(args, requireSuccess);
  return JSON.parse(result.stdout || '{}');
}
function runCli(args, requireSuccess) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: repositoryRoot, env, encoding: 'utf8', timeout: 120000, windowsHide: true });
  if (requireSuccess && result.status !== 0) throw new Error(`agenvyl ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result;
}
function run(command, args, cwd, commandEnv = env) {
  const result = spawnSync(command, args, { cwd, env: commandEnv, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
}
function capture(command, args, commandEnv) {
  const result = spawnSync(command, args, { env: commandEnv, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
  return result.stdout;
}
function terminateTree(pid) {
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else { try { process.kill(-pid, 'SIGKILL'); } catch { process.kill(pid, 'SIGKILL'); } }
}
function processAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolvePromise => setTimeout(resolvePromise, 100)); }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}
async function distinctPorts(count) {
  const ports = [];
  while (ports.length < count) { const port = await freePort(); if (!ports.includes(port)) ports.push(port); }
  return ports;
}
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const address = server.address(); server.close(() => resolvePort(address.port)); });
  });
}
async function writeFixture(path, source) { await writeFile(path, source, { mode: 0o700 }); await chmod(path, 0o700).catch(() => undefined); }
function connectorFixture() { return `import http from 'node:http';\nconst server=http.createServer((request,response)=>{response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({status:'ready'}));});\nserver.listen(Number(process.env.AGENVYL_CONNECTOR_PORT),'127.0.0.1');\nconst stop=()=>server.close(()=>process.exit(0));process.on('SIGTERM',stop);process.on('SIGINT',stop);\n`; }
function coreFixture() { return `import http from 'node:http';\nconst server=http.createServer((request,response)=>{response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({status:'ready'}));});\nserver.listen(Number(process.env.AGENVYL_PORT),'127.0.0.1');\nconst stop=()=>server.close(()=>process.exit(0));process.on('SIGTERM',stop);process.on('SIGINT',stop);\n`; }
