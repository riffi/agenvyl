import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Runtime bundle verification currently requires Linux x64');
const repositoryRoot = resolve(import.meta.dirname, '..');
const archive = resolve(process.argv[2] ?? join(repositoryRoot, 'artifacts/agenvyl-0.1.0-linux-x64.tar.xz'));
if (!process.argv[2]) run('node', ['scripts/build-runtime-bundle.mjs', '--arch', 'x64'], repositoryRoot);

const temporaryRoot = await mkdtemp(join(tmpdir(), 'agenvyl-runtime-smoke-'));
const project = `agenvyl-smoke-${process.pid}`;
const connectorToken = randomBytes(32).toString('hex');
const postgresPassword = randomBytes(24).toString('hex');
const processes = [];
let composeFile;

try {
  run('tar', ['-xJf', archive, '-C', temporaryRoot], repositoryRoot);
  const [bundleName] = (await readFile(`${archive}.sha256`, 'utf8')).trim().split(/\s+/).slice(1).map(name => name.replace(/\.tar\.xz$/, ''));
  const bundleRoot = join(temporaryRoot, bundleName);
  composeFile = join(bundleRoot, 'share/agenvyl/compose.yaml');
  const dataHome = join(temporaryRoot, 'data');
  const configHome = join(temporaryRoot, 'config');
  const workspaceRoot = join(dataHome, 'agenvyl/workspaces');
  const connectorConfig = join(configHome, 'agenvyl/connector.yaml');
  const fakeAgy = join(temporaryRoot, 'agy');
  const [postgresPort, connectorPort, corePort] = await Promise.all([freePort(), freePort(), freePort()]);
  await mkdir(join(configHome, 'agenvyl'), { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(fakeAgy, `#!/bin/sh\nset -eu\nif [ "\${1:-}" = "--version" ]; then echo 1.1.3; exit 0; fi\nif [ "\${1:-}" = "models" ]; then echo bundle-smoke-model; exit 0; fi\nprintf 'bundle-workspace-ok\\n' > .agenvyl-bundle-smoke\necho AGENVYL_BUNDLE_OK\n`);
  await chmod(fakeAgy, 0o755);
  await writeFile(connectorConfig, `version: 1\nlisten:\n  host: 127.0.0.1\n  port: ${connectorPort}\nworkspaces:\n  roots: []\ninstances:\n  - id: local-antigravity\n    type: antigravity\n`);

  const env = {
    ...process.env,
    XDG_DATA_HOME: dataHome,
    XDG_CONFIG_HOME: configHome,
    AGENVYL_WORKSPACE_ROOT: workspaceRoot,
    AGENVYL_CONNECTOR_CONFIG: connectorConfig,
    AGENVYL_CONNECTOR_URL: `http://127.0.0.1:${connectorPort}`,
    AGENVYL_CONNECTOR_TOKEN: connectorToken,
    AGENVYL_CONNECTOR_AGY_COMMAND: fakeAgy,
    AGENVYL_CONNECTOR_AGY_DANGEROUSLY_SKIP_PERMISSIONS: 'true',
    AGENVYL_DATABASE_URL: `postgres://agenvyl:${postgresPassword}@127.0.0.1:${postgresPort}/agenvyl`,
    AGENVYL_HOST: '127.0.0.1',
    AGENVYL_PORT: String(corePort),
    POSTGRES_PASSWORD: postgresPassword,
    AGENVYL_POSTGRES_PORT: String(postgresPort),
  };

  compose(['up', '-d', '--wait'], env);
  let connector = start(join(bundleRoot, 'bin/agenvyl-connector'), env);
  await waitForJson(`${env.AGENVYL_CONNECTOR_URL}/v1/health`, connectorToken, body => body.status === 'ready');
  let core = start(join(bundleRoot, 'bin/agenvyl-core'), env);
  await waitForJson(`http://127.0.0.1:${corePort}/api/v1/health`, undefined, body => body.status === 'ready');

  const persona = await fetch(`http://127.0.0.1:${corePort}/api/v1/personas/persona-architect`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ harness_instance_id: 'local-antigravity', model_id: 'bundle-smoke-model', mode_id: 'accept-edits' }),
  });
  assertStatus(persona, 200, 'select persona');
  const message = await fetch(`http://127.0.0.1:${corePort}/api/v1/rooms/demo-room/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Write the portable runtime smoke artifact.', targets: ['architect'] }),
  });
  assertStatus(message, 202, 'create run');
  const { runIds } = await message.json();
  const completed = await waitForJson(`http://127.0.0.1:${corePort}/api/v1/rooms/demo-room/timeline`, undefined, body => body.runs?.some(run => run.id === runIds[0] && run.status === 'completed'));
  const runResult = completed.runs.find(run => run.id === runIds[0]);
  if (runResult.text !== 'AGENVYL_BUNDLE_OK') throw new Error(`Unexpected harness result: ${runResult.text}`);
  if ((await readFile(join(workspaceRoot, 'demo-room/.agenvyl-bundle-smoke'), 'utf8')) !== 'bundle-workspace-ok\n') throw new Error('Harness did not access the shared host workspace');

  await stop(core, 'SIGKILL');
  core = start(join(bundleRoot, 'bin/agenvyl-core'), env);
  await waitForJson(`http://127.0.0.1:${corePort}/api/v1/rooms/demo-room/timeline`, undefined, body => body.runs?.some(run => run.id === runIds[0] && run.status === 'completed'));

  await stop(connector, 'SIGKILL');
  connector = start(join(bundleRoot, 'bin/agenvyl-connector'), env);
  await waitForJson(`${env.AGENVYL_CONNECTOR_URL}/v1/health`, connectorToken, body => body.status === 'ready');

  await stop(core, 'SIGTERM');
  compose(['stop', 'postgres'], env);
  compose(['start', 'postgres'], env);
  await waitForPostgres(env);
  core = start(join(bundleRoot, 'bin/agenvyl-core'), env);
  await waitForJson(`http://127.0.0.1:${corePort}/api/v1/rooms/demo-room/timeline`, undefined, body => body.runs?.some(run => run.id === runIds[0] && run.status === 'completed'));
  console.log('Portable bundle verified: Core -> Connector -> harness, crash recovery, PostgreSQL persistence, and direct workspace access.');
} finally {
  for (const child of processes.reverse()) await stop(child, 'SIGTERM').catch(() => undefined);
  if (composeFile) spawnSync('docker', ['compose', '-p', project, '-f', composeFile, 'down', '-v'], { stdio: 'inherit' });
  await rm(temporaryRoot, { recursive: true, force: true });
}

function compose(args, env) { run('docker', ['compose', '-p', project, '-f', composeFile, ...args], repositoryRoot, env); }
function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
}
function start(command, env) {
  const child = spawn(command, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  child.once('exit', code => { if (code && code !== 143) console.error(`${command} exited ${code}: ${output.slice(-2000)}`); });
  processes.push(child);
  return child;
}
async function stop(child, signal) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}
async function waitForJson(url, token, predicate) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(2_000) });
      const body = await response.json();
      if (response.ok && predicate(body)) return body;
      lastError = new Error(`${url} returned ${response.status}: ${JSON.stringify(body)}`);
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}
async function waitForPostgres(env) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = spawnSync('docker', ['compose', '-p', project, '-f', composeFile, 'exec', '-T', 'postgres', 'pg_isready', '-U', 'agenvyl', '-d', 'agenvyl'], { env, stdio: 'ignore' });
    if (result.status === 0) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('PostgreSQL did not recover');
}
async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const address = server.address(); server.close(() => resolvePort(address.port)); });
  });
}
function assertStatus(response, expected, label) { if (response.status !== expected) throw new Error(`${label} returned HTTP ${response.status}`); }
