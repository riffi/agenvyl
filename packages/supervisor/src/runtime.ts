import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { chmod, cp, mkdir, open, readFile, readdir, readlink, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { isProcessAlive, spawnLogged, terminateChild, terminateProcessTree } from './processes.js';
import type { SupervisorConfig } from './config.js';
import type { ManagedComponent, RuntimeState, RuntimeStatus } from './types.js';
import { SupervisorError } from './errors.js';

type Secrets = { connectorToken: string; postgresPassword: string };
type ChildMap = Partial<Record<ManagedComponent, ChildProcess>>;
type Check = { name: string; ok: boolean; detail: string };

export async function initializePortableRuntime(config: SupervisorConfig) {
  await prepareDirectories(config);
  try {
    await assertRequiredFiles(config);
    const secrets = await loadOrCreateSecrets(config);
    await writeConnectorConfig(config);
    if (config.managedPostgres) await initializePostgres(config, secrets);
  } finally { await removeWindowsPostgresAliases(config); }
}

export async function startSupervisor(config: SupervisorConfig, cliPath: string, env = process.env, progress?: (stage: 'preparing' | 'launching' | 'waiting' | 'ready') => void) {
  progress?.('preparing');
  await prepareDirectories(config);
  const current = await readState(config);
  if (current && isProcessAlive(current.daemonPid) && current.phase === 'running') return current;
  await cleanStaleRuntime(config, current);
  await assertRequiredFiles(config);
  await assertPortsAvailable(config);
  progress?.('launching');
  const logFile = join(config.paths.logs, 'supervisor.log');
  const log = await open(logFile, 'a', 0o600);
  const child = spawn(config.nodeExecutable, [cliPath, 'daemon'], {
    cwd: config.bundleRoot,
    env: { ...env, AGENVYL_BUNDLE_ROOT: config.bundleRoot },
    detached: true,
    stdio: ['ignore', log.fd, log.fd],
    windowsHide: true,
  });
  child.unref();
  await log.close();
  progress?.('waiting');
  const result = await waitForState(config, state => {
    if (state?.phase === 'failed') throw new Error(state.failure?.message ?? 'Agenvyl failed to start');
    return state?.phase === 'running' ? state : undefined;
  }, config.readinessTimeoutMs * (config.managedPostgres ? 4 : 3));
  progress?.('ready');
  return result;
}

export async function runSupervisorDaemon(config: SupervisorConfig, env = process.env) {
  await prepareDirectories(config);
  const lock = await acquireLock(config);
  logEvent('supervisor_starting', { pid: process.pid, managedPostgres: config.managedPostgres });
  const children: ChildMap = {};
  let stopping = false;
  const state: RuntimeState = {
    schemaVersion: 1,
    daemonPid: process.pid,
    phase: 'starting',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    managedPostgres: config.managedPostgres,
    ports: { postgresql: config.postgresPort, connector: config.connectorPort, core: config.corePort },
    components: {},
  };
  const requestStop = () => { stopping = true; };
  process.on('SIGINT', requestStop);
  process.on('SIGTERM', requestStop);
  try {
    await rm(config.stopRequestFile, { force: true });
    await writeState(config, state);
    const secrets = await loadOrCreateSecrets(config);
    const databaseUrl = config.externalDatabaseUrl ?? managedDatabaseUrl(config, secrets);
    if (config.managedPostgres) {
      await initializePostgres(config, secrets);
      const postgres = await startPostgres(config, secrets, state);
      if (postgres) children.postgresql = postgres;
      await waitForPostgres(config, secrets);
    } else {
      await waitForExternalDatabase(config, databaseUrl);
    }
    await writeConnectorConfig(config);
    children.connector = await startNodeComponent('connector', config.connectorEntrypoint, config, state, {
      ...env,
      AGENVYL_CONNECTOR_CONFIG: config.connectorConfigFile,
      AGENVYL_CONNECTOR_TOKEN: secrets.connectorToken,
      AGENVYL_WORKSPACE_ROOT: config.paths.workspaces,
      AGENVYL_CONNECTOR_PORT: String(config.connectorPort),
    });
    await waitForHttp(`http://127.0.0.1:${config.connectorPort}/v2/health`, config.readinessTimeoutMs, secrets.connectorToken);
    children.core = await startNodeComponent('core', config.coreEntrypoint, config, state, {
      ...env,
      AGENVYL_DATABASE_URL: databaseUrl,
      AGENVYL_CONNECTOR_URL: `http://127.0.0.1:${config.connectorPort}`,
      AGENVYL_CONNECTOR_TOKEN: secrets.connectorToken,
      AGENVYL_HOST: '127.0.0.1',
      AGENVYL_PORT: String(config.corePort),
      AGENVYL_WORKSPACE_ROOT: config.paths.workspaces,
    });
    await waitForHttp(`http://127.0.0.1:${config.corePort}/api/v1/health`, config.readinessTimeoutMs);
    state.phase = 'running';
    await writeState(config, state);
    logEvent('supervisor_running', { pid: process.pid });

    await new Promise<void>(resolvePromise => {
      const timer = setInterval(async () => {
        if (stopping || await exists(config.stopRequestFile)) {
          clearInterval(timer);
          resolvePromise();
          return;
        }
        for (const [name, component] of Object.entries(state.components) as [ManagedComponent, { pid: number }][]) {
          if (!isProcessAlive(component.pid)) {
            state.failure = { component: name, message: `${name} exited unexpectedly` };
            state.phase = 'failed';
            await writeState(config, state);
            clearInterval(timer);
            resolvePromise();
            return;
          }
        }
      }, 250);
    });
  } catch (error) {
    state.phase = 'failed';
    state.failure = { message: errorMessage(error) };
    await writeState(config, state).catch(() => undefined);
    logEvent('supervisor_failed', { error: state.failure.message });
    await delay(500);
  } finally {
    logEvent('supervisor_stopping', { pid: process.pid });
    state.phase = 'stopping';
    await writeState(config, state).catch(() => undefined);
    await stopChildren(config, children);
    await rm(config.stopRequestFile, { force: true });
    await rm(config.stateFile, { force: true });
    await lock.close();
    await rm(config.lockFile, { force: true });
    await removeWindowsPostgresAliases(config);
    logEvent('supervisor_stopped', { pid: process.pid });
  }
}

export async function stopSupervisor(config: SupervisorConfig) {
  const state = await readState(config);
  if (!state) return { stopped: true, message: 'Agenvyl is not running' };
  if (!isProcessAlive(state.daemonPid)) {
    await cleanStaleRuntime(config, state);
    return { stopped: true, message: 'Removed stale runtime state' };
  }
  await writeFile(config.stopRequestFile, `${new Date().toISOString()}\n`, { mode: 0o600 });
  try {
    await waitUntil(async () => !(await exists(config.stateFile)) || !isProcessAlive(state.daemonPid), config.gracePeriodMs * 2);
  } catch {
    terminateProcessTree(state.daemonPid, config.platform);
    await cleanStaleRuntime(config, state);
  }
  return { stopped: true, message: 'Agenvyl stopped' };
}

export async function getSupervisorStatus(config: SupervisorConfig): Promise<RuntimeStatus> {
  const state = await readState(config);
  if (!state) return { running: false, stale: false, health: {} };
  const alive = isProcessAlive(state.daemonPid);
  const health: RuntimeStatus['health'] = {};
  if (alive) {
    health.connector = await httpHealthy(`http://127.0.0.1:${state.ports.connector}/v2/health`) ? 'ready' : 'not_ready';
    health.core = await httpHealthy(`http://127.0.0.1:${state.ports.core}/api/v1/health`) ? 'ready' : 'not_ready';
    health.postgresql = state.managedPostgres && !isProcessAlive(state.components.postgresql?.pid ?? 0) ? 'not_ready' : 'ready';
  }
  return { running: alive && state.phase === 'running', stale: !alive, state, health };
}

export async function readLogs(config: SupervisorConfig, component = 'supervisor', lines = 100) {
  if (!['supervisor', 'postgresql', 'connector', 'core'].includes(component)) throw new Error(`Unknown log component: ${component}`);
  if (!Number.isSafeInteger(lines) || lines < 1 || lines > 10_000) throw new Error('--lines must be between 1 and 10000');
  const file = join(config.paths.logs, `${component}.log`);
  try { return (await readFile(file, 'utf8')).split(/\r?\n/).slice(-lines - 1).join('\n'); }
  catch (error) { if (isMissing(error)) return ''; throw error; }
}

export async function doctor(config: SupervisorConfig): Promise<{ ok: boolean; checks: Check[] }> {
  const checks: Check[] = [];
  checks.push(await fileCheck('Node runtime', config.nodeExecutable));
  checks.push(await fileCheck('Core entrypoint', config.coreEntrypoint));
  checks.push(await fileCheck('Connector entrypoint', config.connectorEntrypoint));
  if (config.managedPostgres) for (const tool of ['postgres', 'initdb', 'pg_isready', 'pg_dump', 'pg_restore']) checks.push(await fileCheck(`PostgreSQL ${tool}`, actualPostgresTool(config, tool)));
  for (const [name, port] of [['Core port', config.corePort], ['Connector port', config.connectorPort], ...(config.managedPostgres ? [['PostgreSQL port', config.postgresPort] as [string, number]] : [])] as [string, number][]) {
    const available = await portAvailable(port);
    const state = await readState(config);
    const owned = Boolean(state && isProcessAlive(state.daemonPid));
    checks.push({ name, ok: available || owned, detail: available ? `${port} is available` : owned ? `${port} is owned by Agenvyl` : `${port} is already in use` });
  }
  if (!config.managedPostgres) checks.push({ name: 'Database mode', ok: true, detail: 'External AGENVYL_DATABASE_URL; PostgreSQL lifecycle is unmanaged' });
  return { ok: checks.every(check => check.ok), checks };
}

export async function backupDatabase(config: SupervisorConfig, destination?: string) {
  await prepareDirectories(config);
  const secrets = await loadOrCreateSecrets(config);
  const databaseUrl = config.externalDatabaseUrl ?? managedDatabaseUrl(config, secrets);
  if (config.managedPostgres && !(await getSupervisorStatus(config)).running) throw new Error('Managed Agenvyl must be running before backup');
  const file = destination ?? join(config.paths.backups, `agenvyl-${timestamp()}.dump`);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  runTool(postgresTool(config, 'pg_dump'), ['--dbname', databaseUrl, '--format=custom', '--compress=0', '--file', postgresVisiblePath(config, file)], postgresEnv(config, secrets));
  await chmod(file, 0o600).catch(() => undefined);
  return file;
}

export async function restoreDatabase(config: SupervisorConfig, archive: string) {
  const status = await getSupervisorStatus(config);
  if (status.state && !status.stale) throw new Error('Stop Agenvyl before restore');
  if (status.stale) await cleanStaleRuntime(config, status.state);
  if (!config.managedPostgres) throw new Error('Restore is disabled for external AGENVYL_DATABASE_URL; use the server database procedure');
  if (!(await exists(archive))) throw new Error(`Backup does not exist: ${archive}`);
  await prepareDirectories(config);
  const secrets = await loadOrCreateSecrets(config);
  await initializePostgres(config, secrets);
  const env = postgresEnv(config, secrets);
  const logFile = join(config.paths.logs, 'postgresql-restore.log');
  runControlTool(postgresTool(config, 'pg_ctl'), ['-D', postgresDataPath(config), '-l', postgresVisiblePath(config, logFile), '-o', `-h 127.0.0.1 -p ${config.postgresPort}`, '-w', 'start'], env);
  try {
    const admin = managedDatabaseUrl(config, secrets, 'postgres');
    runTool(postgresTool(config, 'dropdb'), ['--if-exists', `--maintenance-db=${admin}`, 'agenvyl'], env);
    runTool(postgresTool(config, 'createdb'), [`--maintenance-db=${admin}`, 'agenvyl'], env);
    runTool(postgresTool(config, 'pg_restore'), ['--exit-on-error', '--no-owner', '--dbname', managedDatabaseUrl(config, secrets), postgresVisiblePath(config, archive)], env);
  } finally {
    runControlTool(postgresTool(config, 'pg_ctl'), ['-D', postgresDataPath(config), '-m', 'fast', '-w', 'stop'], env, true);
    await removeWindowsPostgresAliases(config);
  }
  return archive;
}

async function prepareDirectories(config: SupervisorConfig) {
  for (const directory of [config.paths.config, config.paths.data, config.paths.backups, config.paths.logs, config.paths.postgres, config.paths.state, config.paths.workspaces]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => undefined);
  }
  if (config.managedPostgres) await ensureWindowsPostgresAliases(config);
}

async function loadOrCreateSecrets(config: SupervisorConfig): Promise<Secrets> {
  try {
    const value = JSON.parse(await readFile(config.secretsFile, 'utf8')) as Partial<Secrets>;
    if (typeof value.connectorToken !== 'string' || value.connectorToken.length < 32 || typeof value.postgresPassword !== 'string' || value.postgresPassword.length < 32) throw new Error(`Invalid supervisor secrets file: ${config.secretsFile}`);
    await chmod(config.secretsFile, 0o600).catch(() => undefined);
    return value as Secrets;
  }
  catch (error) {
    if (!isMissing(error)) throw error;
    const secrets = { connectorToken: randomBytes(32).toString('base64url'), postgresPassword: randomBytes(32).toString('base64url') };
    await writeFile(config.secretsFile, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await chmod(config.secretsFile, 0o600).catch(() => undefined);
    return secrets;
  }
}

async function acquireLock(config: SupervisorConfig) {
  try {
    const handle = await open(config.lockFile, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
    return handle;
  } catch (error) {
    if (!isExists(error)) throw error;
    const state = await readState(config);
    if (state && isProcessAlive(state.daemonPid)) throw new Error(`Agenvyl is already managed by PID ${state.daemonPid}`);
    await cleanStaleRuntime(config, state);
    const handle = await open(config.lockFile, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
    return handle;
  }
}

async function cleanStaleRuntime(config: SupervisorConfig, state: RuntimeState | undefined) {
  if (state && !isProcessAlive(state.daemonPid)) {
    for (const component of Object.values(state.components)) if (component && isProcessAlive(component.pid)) terminateProcessTree(component.pid, config.platform);
  }
  await rm(config.stateFile, { force: true });
  await rm(config.lockFile, { force: true });
  await rm(config.stopRequestFile, { force: true });
}

async function initializePostgres(config: SupervisorConfig, secrets: Secrets) {
  if (await exists(join(config.paths.postgres, 'PG_VERSION'))) return;
  const aliased = usesWindowsPostgresAliases(config);
  const staging = postgresDataPath(config);
  const passwordFile = aliased ? join(windowsPostgresAliasRoot(config), `password-${process.pid}`) : join(config.paths.state, `postgres-password-${process.pid}`);
  await writeFile(passwordFile, `${secrets.postgresPassword}\n`, { mode: 0o600 });
  try {
    runTool(postgresTool(config, 'initdb'), ['-D', staging, '-U', 'agenvyl', '-A', 'scram-sha-256', '--pwfile', passwordFile, '--no-locale'], postgresEnv(config, secrets));
  } finally { await rm(passwordFile, { force: true }); }
}

async function startPostgres(config: SupervisorConfig, secrets: Secrets, state: RuntimeState) {
  const logFile = join(config.paths.logs, 'postgresql.log');
  if (config.platform === 'win32') {
    runControlTool(postgresTool(config, 'pg_ctl'), ['-D', postgresDataPath(config), '-l', postgresVisiblePath(config, logFile), '-o', `-h 127.0.0.1 -p ${config.postgresPort}`, '-w', '-t', String(Math.ceil(config.readinessTimeoutMs / 1000)), 'start'], postgresEnv(config, secrets));
    const pid = Number((await readFile(join(config.paths.postgres, 'postmaster.pid'), 'utf8')).split(/\r?\n/, 1)[0]);
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Managed PostgreSQL did not provide a valid postmaster PID');
    state.components.postgresql = { pid, startedAt: new Date().toISOString(), logFile };
    await writeState(config, state);
    return undefined;
  }
  const component = await spawnLogged(postgresTool(config, 'postgres'), ['-D', postgresDataPath(config), '-h', '127.0.0.1', '-p', String(config.postgresPort)], {
    cwd: config.paths.data, env: postgresEnv(config, secrets), logFile,
  });
  await recordComponent(config, state, 'postgresql', component);
  return component;
}

async function waitForPostgres(config: SupervisorConfig, secrets: Secrets) {
  const env = postgresEnv(config, secrets);
  await waitUntil(async () => spawnSync(postgresTool(config, 'pg_isready'), ['-h', '127.0.0.1', '-p', String(config.postgresPort), '-U', 'agenvyl'], { env, stdio: 'ignore', windowsHide: true }).status === 0, config.readinessTimeoutMs);
  const admin = managedDatabaseUrl(config, secrets, 'postgres');
  const result = spawnSync(postgresTool(config, 'psql'), ['--dbname', admin, '-At', '-c', "SELECT 1 FROM pg_database WHERE datname='agenvyl'"], { env, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`Unable to inspect managed PostgreSQL: ${result.stderr}`);
  if (result.stdout.trim() !== '1') runTool(postgresTool(config, 'createdb'), [`--maintenance-db=${admin}`, 'agenvyl'], env);
}

async function waitForExternalDatabase(config: SupervisorConfig, url: string) {
  const tool = postgresTool(config, 'pg_isready');
  if (!(await exists(tool))) return;
  await waitUntil(async () => spawnSync(tool, ['--dbname', url], { stdio: 'ignore', windowsHide: true }).status === 0, config.readinessTimeoutMs);
}

async function startNodeComponent(name: ManagedComponent, entrypoint: string, config: SupervisorConfig, state: RuntimeState, env: NodeJS.ProcessEnv) {
  const child = await spawnLogged(config.nodeExecutable, [entrypoint], { cwd: config.appRoot, env, logFile: join(config.paths.logs, `${name}.log`) });
  await recordComponent(config, state, name, child);
  return child;
}

async function recordComponent(config: SupervisorConfig, state: RuntimeState, name: ManagedComponent, child: ChildProcess) {
  if (!child.pid) throw new Error(`${name} did not provide a PID`);
  state.components[name] = { pid: child.pid, startedAt: new Date().toISOString(), logFile: join(config.paths.logs, `${name}.log`) };
  await writeState(config, state);
}

async function stopChildren(config: SupervisorConfig, children: ChildMap) {
  for (const name of ['core', 'connector'] as const) if (children[name]) await terminateChild(children[name]!, config.platform, config.gracePeriodMs);
  if (config.managedPostgres) {
    const secrets = await loadOrCreateSecrets(config).catch(() => undefined);
    if (secrets) runControlTool(postgresTool(config, 'pg_ctl'), ['-D', postgresDataPath(config), '-m', 'fast', '-w', '-t', String(Math.ceil(config.gracePeriodMs / 1000)), 'stop'], postgresEnv(config, secrets), true);
    if (children.postgresql) await terminateChild(children.postgresql, config.platform, config.gracePeriodMs);
  }
}

async function writeConnectorConfig(config: SupervisorConfig) {
  const content = `version: 1\nlisten:\n  host: 127.0.0.1\n  port: ${config.connectorPort}\nworkspaces:\n  roots:\n    - ${JSON.stringify(config.paths.workspaces)}\ninstances: []\n`;
  await mkdir(dirname(config.connectorConfigFile), { recursive: true, mode: 0o700 });
  if (!(await exists(config.connectorConfigFile))) await writeFile(config.connectorConfigFile, content, { mode: 0o600, flag: 'wx' });
}

async function assertRequiredFiles(config: SupervisorConfig) {
  for (const file of [config.nodeExecutable, config.coreEntrypoint, config.connectorEntrypoint]) if (!(await exists(file))) throw new Error(`Required runtime file is missing: ${file}`);
  if (config.managedPostgres) for (const tool of ['postgres', 'initdb', 'pg_isready', 'psql', 'createdb', 'dropdb', 'pg_ctl', 'pg_dump', 'pg_restore']) if (!(await exists(postgresTool(config, tool)))) throw new Error(`Bundled PostgreSQL tool is missing: ${tool}`);
}

async function assertPortsAvailable(config: SupervisorConfig) {
  for (const [name, port] of [['Core', config.corePort], ['Connector', config.connectorPort], ...(config.managedPostgres ? [['PostgreSQL', config.postgresPort] as [string, number]] : [])] as [string, number][]) {
    if (!(await portAvailable(port))) throw new Error(`${name} port ${port} is already in use`);
  }
}

function actualPostgresTool(config: SupervisorConfig, name: string) { return join(config.postgresRoot, 'bin', config.platform === 'win32' ? `${name}.exe` : name); }
function postgresTool(config: SupervisorConfig, name: string) { return join(postgresRuntimePath(config), 'bin', config.platform === 'win32' ? `${name}.exe` : name); }
function postgresEnv(config: SupervisorConfig, secrets: Secrets): NodeJS.ProcessEnv {
  const runtime = postgresRuntimePath(config);
  const env: NodeJS.ProcessEnv = { ...process.env, PGPASSWORD: secrets.postgresPassword, PATH: `${join(runtime, 'bin')}${config.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` };
  if (config.platform === 'linux') env.LD_LIBRARY_PATH = `${join(config.postgresRoot, 'lib')}:${process.env.LD_LIBRARY_PATH ?? ''}`;
  if (config.platform === 'darwin') env.DYLD_LIBRARY_PATH = `${join(config.postgresRoot, 'lib')}:${process.env.DYLD_LIBRARY_PATH ?? ''}`;
  return env;
}
function usesWindowsPostgresAliases(config: SupervisorConfig) {
  return config.platform === 'win32' && /[^\x00-\x7F]/.test(`${windowsSafePath(config.postgresRoot)}\n${windowsSafePath(config.paths.data)}`);
}
function windowsPostgresAliasRoot(config: SupervisorConfig) {
  const publicRoot = process.env.PUBLIC ?? join(process.env.SystemDrive ?? 'C:', 'Users', 'Public');
  const safePublic = windowsSafePath(publicRoot);
  const storageRoot = /[^\x00-\x7F]/.test(safePublic) ? `${process.env.SystemDrive ?? 'C:'}\\ProgramData` : safePublic;
  const digest = createHash('sha256').update(resolve(config.paths.data)).digest('hex').slice(0, 16);
  return join(storageRoot, 'Agenvyl', 'RuntimeAliases', digest);
}
function postgresRuntimePath(config: SupervisorConfig) { return usesWindowsPostgresAliases(config) ? join(windowsPostgresAliasRoot(config), 'runtime') : windowsSafePath(config.postgresRoot); }
function postgresDataPath(config: SupervisorConfig) { return usesWindowsPostgresAliases(config) ? join(windowsPostgresAliasRoot(config), 'data-store') : windowsSafePath(config.paths.postgres); }
function postgresVisiblePath(config: SupervisorConfig, value: string) {
  const safe = windowsSafePath(value);
  if (!usesWindowsPostgresAliases(config) || !/[^\x00-\x7F]/.test(safe)) return safe;
  const mappings = [
    [config.paths.state, 'state'], [config.paths.logs, 'logs'], [config.paths.backups, 'backups'], [config.paths.postgres, 'data-store'], [config.postgresRoot, 'runtime'],
  ] as const;
  for (const [source, alias] of mappings) {
    const nested = relative(resolve(source), resolve(value));
    if (nested === '' || (!nested.startsWith('..') && !/^[A-Za-z]:/.test(nested))) return join(windowsPostgresAliasRoot(config), alias, nested);
  }
  if (/[^\x00-\x7F]/.test(value)) throw new SupervisorError('POSTGRES_UNICODE_EXTERNAL_PATH', 'PostgreSQL cannot read this external Unicode path on Windows.', 'Move the file into the Agenvyl backups folder and retry.', { path: value });
  return value;
}
function windowsSafePath(value: string) {
  if (process.platform !== 'win32' || !/[^\x00-\x7F]/.test(value)) return value;
  let ancestor = resolve(value);
  const suffix: string[] = [];
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) return value;
    suffix.unshift(basename(ancestor)); ancestor = parent;
  }
  const result = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'for %I in ("%AGENVYL_SHORT_PATH%") do @echo %~sI'], {
    env: { ...process.env, AGENVYL_SHORT_PATH: ancestor }, encoding: 'buffer', windowsHide: true,
  });
  const shortAncestor = Buffer.isBuffer(result.stdout) ? result.stdout.toString('ascii').trim() : '';
  if (result.status !== 0 || !shortAncestor || /[^\x20-\x7E]/.test(shortAncestor) || !existsSync(shortAncestor)) return value;
  return join(shortAncestor, ...suffix);
}
async function ensureWindowsPostgresAliases(config: SupervisorConfig) {
  if (!usesWindowsPostgresAliases(config)) return;
  const root = windowsPostgresAliasRoot(config);
  await mkdir(root, { recursive: true, mode: 0o700 });
  secureWindowsDirectory(root);
  const store = join(root, 'data-store');
  await mkdir(store, { recursive: true, mode: 0o700 });
  const currentLink = await readlink(config.paths.postgres).catch(() => undefined);
  if (!currentLink) {
    for (const entry of await readdir(config.paths.postgres)) {
      const source = join(config.paths.postgres, entry), destination = join(store, entry);
      try { await rename(source, destination); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
        await cp(source, destination, { recursive: true }); await rm(source, { recursive: true, force: true });
      }
    }
    await rm(config.paths.postgres, { recursive: true, force: true });
    await symlink(store, config.paths.postgres, 'junction');
  } else if (resolve(currentLink).toLowerCase() !== resolve(store).toLowerCase()) {
    throw new SupervisorError('POSTGRES_DATA_LINK_INVALID', 'The Windows PostgreSQL data link points to an unexpected location.', 'Run repair after moving the conflicting directory.', { path: config.paths.postgres });
  }
  for (const [name, target] of [['runtime', config.postgresRoot], ['state', config.paths.state], ['logs', config.paths.logs], ['backups', config.paths.backups]] as const) {
    const alias = join(root, name);
    if (await exists(alias)) {
      const linked = await readlink(alias).catch(() => undefined);
      if (!linked || resolve(linked).toLowerCase() !== resolve(target).toLowerCase()) throw new SupervisorError('POSTGRES_ALIAS_COLLISION', `Windows PostgreSQL alias is occupied: ${alias}`, 'Remove the conflicting alias and retry.');
      continue;
    }
    await symlink(resolve(target), alias, 'junction');
  }
}
function secureWindowsDirectory(path: string) {
  const identity = spawnSync(windowsSystemTool('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  const sid = identity.stdout.match(/S-\d+(?:-\d+)+/)?.[0];
  if (!sid) throw new SupervisorError('WINDOWS_IDENTITY_UNAVAILABLE', 'Unable to secure the Windows PostgreSQL storage directory.', 'Run Agenvyl from a normal user session.');
  const secured = spawnSync(windowsSystemTool('icacls.exe'), [path, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { encoding: 'utf8', windowsHide: true });
  if (secured.status !== 0) throw new SupervisorError('WINDOWS_STORAGE_ACL_FAILED', 'Unable to restrict access to the Windows PostgreSQL storage directory.', 'Check permissions for the Public folder.', { path });
}
function windowsSystemTool(name: string) { return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', name); }
export async function removeWindowsPostgresAliases(config: SupervisorConfig) {
  if (!usesWindowsPostgresAliases(config)) return;
  const root = windowsPostgresAliasRoot(config);
  for (const name of ['runtime', 'state', 'logs', 'backups']) await rm(join(root, name), { force: true }).catch(() => undefined);
  await rm(root, { force: true }).catch(() => undefined);
}
export async function purgeWindowsPostgresStorage(config: SupervisorConfig) {
  if (!usesWindowsPostgresAliases(config)) return;
  const root = windowsPostgresAliasRoot(config);
  await removeWindowsPostgresAliases(config);
  await rm(join(root, 'data-store'), { recursive: true, force: true });
  await rm(root, { force: true }).catch(() => undefined);
}
function managedDatabaseUrl(config: SupervisorConfig, secrets: Secrets, database = 'agenvyl') { return `postgresql://agenvyl:${encodeURIComponent(secrets.postgresPassword)}@127.0.0.1:${config.postgresPort}/${database}`; }

async function writeState(config: SupervisorConfig, state: RuntimeState) {
  state.updatedAt = new Date().toISOString();
  const temporary = `${config.stateFile}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    if (config.platform === 'win32') await removeWindowsReplaceTarget(config.stateFile);
    await retryWindowsFsOperation(config.platform, () => rename(temporary, config.stateFile));
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
async function removeWindowsReplaceTarget(path: string) {
  await retryWindowsFsOperation('win32', () => rm(path, { force: true }));
}
async function retryWindowsFsOperation(platform: NodeJS.Platform, operation: () => Promise<void>) {
  const attempts = platform === 'win32' ? 10 : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { await operation(); return; }
    catch (error) {
      if (attempt === attempts || !isTransientWindowsFsError(error)) throw error;
      await delay(attempt * 50);
    }
  }
}
async function readState(config: SupervisorConfig) {
  try { return JSON.parse(await readFile(config.stateFile, 'utf8')) as RuntimeState; }
  catch (error) { if (isMissing(error)) return undefined; throw new Error(`Invalid supervisor state: ${errorMessage(error)}`); }
}
async function waitForState<T>(config: SupervisorConfig, predicate: (state: RuntimeState | undefined) => T | undefined, timeoutMs: number) {
  let result: T | undefined;
  await waitUntil(async () => { result = predicate(await readState(config)); return result !== undefined; }, timeoutMs);
  return result!;
}
async function waitForHttp(url: string, timeoutMs: number, token?: string) { await waitUntil(() => httpHealthy(url, token), timeoutMs); }
async function httpHealthy(url: string, token?: string) {
  try { const response = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : undefined, signal: AbortSignal.timeout(1000) }); return response.ok; }
  catch { return false; }
}
async function waitUntil(check: () => boolean | Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await check()) return; await delay(100); }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}
async function portAvailable(port: number) {
  return new Promise<boolean>(resolvePromise => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolvePromise(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(() => resolvePromise(true)));
  });
}
async function fileCheck(name: string, file: string): Promise<Check> { return { name, ok: await exists(file), detail: file }; }
async function exists(path: string) { try { await stat(path); return true; } catch (error) { if (isMissing(error)) return false; throw error; } }
function runTool(command: string, args: string[], env: NodeJS.ProcessEnv, ignoreFailure = false) {
  const result = spawnSync(command, args, { env, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0 && !ignoreFailure) throw new Error(`${basename(command)} failed (${result.status}): ${(result.stderr || result.stdout).trim()}`);
  return result;
}
function runControlTool(command: string, args: string[], env: NodeJS.ProcessEnv, ignoreFailure = false) {
  const result = spawnSync(command, args, { env, stdio: 'ignore', windowsHide: true });
  if (result.status !== 0 && !ignoreFailure) throw new Error(`${basename(command)} failed with status ${result.status}`);
  return result;
}
function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function delay(ms: number) { return new Promise<void>(resolvePromise => setTimeout(resolvePromise, ms)); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function isMissing(error: unknown) { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
function isExists(error: unknown) { return (error as NodeJS.ErrnoException)?.code === 'EEXIST'; }
function isTransientWindowsFsError(error: unknown) { return ['EACCES', 'EBUSY', 'EPERM'].includes((error as NodeJS.ErrnoException)?.code ?? ''); }
function logEvent(event: string, details: Record<string, unknown>) { process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), event, ...details })}\n`); }
