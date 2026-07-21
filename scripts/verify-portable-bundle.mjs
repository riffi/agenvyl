import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { NODE_VERSION, runtimeBundleTarget } from './runtime-bundle-config.mjs';
import { POSTGRES_RUNTIME_CONFIG } from './postgres-runtime-config.mjs';

if (!process.argv[2]) throw new Error('Usage: node scripts/verify-portable-bundle.mjs <portable-archive>');
const sourceArchive = resolve(process.argv[2]);
const sourceSidecar = `${sourceArchive}.sha256`;
const target = runtimeBundleTarget(process.platform, process.arch);
const temporaryRoot = await mkdtemp(join(tmpdir(), 'agenvyl portable ü '));
const archiveRoot = join(temporaryRoot, 'incoming archives');
const extractionRoot = join(temporaryRoot, 'unpacked target ü');
const archive = join(archiveRoot, basename(sourceArchive));
const home = join(temporaryRoot, 'personal data ü');
const [corePort, connectorPort, postgresPort] = await distinctPorts(3);
let bundleRoot;

try {
  await cp(sourceArchive, archive, { recursive: true });
  await cp(sourceSidecar, `${archive}.sha256`);
  const expectedArchiveSha = (await readFile(`${archive}.sha256`, 'utf8')).trim().split(/\s+/, 1)[0];
  const actualArchiveSha = digest(await readFile(archive));
  if (actualArchiveSha !== expectedArchiveSha) throw new Error(`Portable archive checksum mismatch: ${actualArchiveSha}`);

  await extract(archive, extractionRoot, target.archiveFormat);
  const entries = await readdir(extractionRoot);
  if (entries.length !== 1) throw new Error(`Portable archive must contain one root directory: ${entries.join(', ')}`);
  bundleRoot = join(extractionRoot, entries[0]);
  const manifest = JSON.parse(await readFile(join(bundleRoot, 'manifest.json'), 'utf8'));
  if (manifest.platform !== process.platform || manifest.architecture !== process.arch) {
    throw new Error(`Portable manifest target mismatch: ${manifest.platform}-${manifest.architecture}`);
  }
  if (manifest.node?.version !== NODE_VERSION || manifest.postgres?.version !== POSTGRES_RUNTIME_CONFIG.version) {
    throw new Error(`Portable manifest dependency mismatch: ${JSON.stringify(manifest)}`);
  }

  const node = join(bundleRoot, 'runtime', process.platform === 'win32' ? 'node.exe' : 'bin/node');
  const postgres = join(bundleRoot, 'postgres', 'bin', process.platform === 'win32' ? 'postgres.exe' : 'postgres');
  expectOutput(node, ['--version'], `v${NODE_VERSION}`);
  expectOutput(postgres, ['--version'], `postgres (PostgreSQL) ${POSTGRES_RUNTIME_CONFIG.version}`);

  const env = {
    ...process.env,
    AGENVYL_HOME: home,
    AGENVYL_NO_OPEN_BROWSER: '1',
    AGENVYL_PORT: String(corePort),
    AGENVYL_CONNECTOR_PORT: String(connectorPort),
    AGENVYL_POSTGRES_PORT: String(postgresPort),
    AGENVYL_READINESS_TIMEOUT_MS: '60000',
    AGENVYL_SHUTDOWN_TIMEOUT_MS: '10000',
    LOCALAPPDATA: home,
    XDG_CONFIG_HOME: join(home, 'config'),
    XDG_DATA_HOME: join(home, 'data'),
  };
  const cli = join(bundleRoot, 'bin', process.platform === 'win32' ? 'agenvyl.cmd' : 'agenvyl');
  const extension = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'command' : 'sh';
  const launcher = action => join(bundleRoot, `${action} Agenvyl.${extension}`);

  const doctor = cliJson(cli, ['doctor', '--json'], env);
  if (!doctor.ok) throw new Error(`Portable doctor failed: ${JSON.stringify(doctor)}`);
  runLauncher(launcher('Start'), env);
  const status = cliJson(cli, ['status', '--json'], env);
  if (!status.running || status.state?.phase !== 'running') throw new Error(`Portable Start did not reach running state: ${JSON.stringify(status)}`);
  await waitForHttp(`http://127.0.0.1:${corePort}/api/v1/health`);
  const frontend = await fetch(`http://127.0.0.1:${corePort}/`, { signal: AbortSignal.timeout(2000) });
  if (!frontend.ok || !(await frontend.text()).includes('<!doctype html>')) throw new Error('Portable Web UI was not served');
  const humanStatus = runLauncher(launcher('Status'), env);
  if (!humanStatus.stdout.includes('Agenvyl is running')) throw new Error(`Status launcher returned unexpected output: ${humanStatus.stdout}`);

  const pids = [status.state.daemonPid, ...Object.values(status.state.components).map(component => component.pid)];
  runLauncher(launcher('Stop'), env);
  await waitFor(() => pids.every(pid => !processAlive(pid)), 30000);
  const stopped = runCli(cli, ['status', '--json'], env, false);
  if (stopped.status !== 3 || JSON.parse(stopped.stdout).running) throw new Error(`Portable Stop left a running state: ${stopped.stdout || stopped.stderr}`);
  for (const port of [corePort, connectorPort, postgresPort]) if (!(await portAvailable(port))) throw new Error(`Portable Stop did not release port ${port}`);
  console.log(`Portable bundle verified: ${process.platform}-${process.arch}, bundled Node/PostgreSQL, launchers, Web UI, and orphan-free stop.`);
} catch (error) {
  await diagnostics(home);
  throw error;
} finally {
  if (bundleRoot) {
    const cli = join(bundleRoot, 'bin', process.platform === 'win32' ? 'agenvyl.cmd' : 'agenvyl');
    runCli(cli, ['stop', '--json'], { ...process.env, AGENVYL_HOME: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data') }, false);
  }
  try {
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: process.platform === 'win32' ? 10 : 0, retryDelay: 250 });
  } catch (error) {
    if (process.platform !== 'win32' || !['EACCES', 'EBUSY', 'EPERM'].includes(error?.code)) throw error;
    console.warn(`Windows deferred temporary cleanup (${error.code}): ${temporaryRoot}`);
  }
}

async function extract(archive, destination, format) {
  await mkdir(destination, { recursive: true });
  const mode = format === 'tar.xz' ? '-xJf' : '-xf';
  run(tarCommand(), [mode, archive, '-C', destination]);
}
function cliJson(cli, args, env) {
  const result = runCli(cli, args, env, true);
  return JSON.parse(result.stdout);
}
function runCli(cli, args, env, requireSuccess) {
  const result = process.platform === 'win32'
    ? runWindowsCommand(cli, args, env)
    : spawnSync(cli, args, { env, encoding: 'utf8', timeout: 300000 });
  if (requireSuccess && result.status !== 0) throw new Error(`${basename(cli)} ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result;
}
function runLauncher(path, env) {
  const result = process.platform === 'win32'
    ? runWindowsCommand(path, [], env)
    : spawnSync(path, [], { env, encoding: 'utf8', timeout: 300000 });
  if (result.status !== 0) throw new Error(`${basename(path)} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result;
}
function runWindowsCommand(command, args, env) {
  const invocation = `call "${command}" ${args.map(argument => `"${argument.replaceAll('"', '""')}"`).join(' ')}`;
  return spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', invocation], { env, encoding: 'utf8', timeout: 300000, windowsHide: true });
}
function expectOutput(command, args, expected) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0 || !result.stdout.trim().includes(expected)) throw new Error(`${basename(command)} returned unexpected version: ${result.stderr || result.stdout}`);
}
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
}
async function diagnostics(homeRoot) {
  const dataRoot = process.platform === 'win32' ? join(homeRoot, 'Agenvyl') : process.platform === 'darwin' ? join(homeRoot, 'Library/Application Support/Agenvyl') : join(homeRoot, 'data/agenvyl');
  for (const file of [join(dataRoot, 'state/supervisor.json'), ...['supervisor', 'postgresql', 'connector', 'core'].map(name => join(dataRoot, `logs/${name}.log`))]) {
    try { console.error(`\n--- ${file} ---\n${(await readFile(file, 'utf8')).slice(-8000)}`); } catch { /* file was not created */ }
  }
}
async function waitForHttp(url) {
  await waitFor(async () => {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(2000) }); return response.ok; } catch { return false; }
  }, 60000);
}
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
function portAvailable(port) {
  return new Promise(resolveAvailable => {
    const server = createServer();
    server.once('error', () => resolveAvailable(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolveAvailable(true)));
  });
}
function processAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function tarCommand() { return process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'; }
function digest(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
