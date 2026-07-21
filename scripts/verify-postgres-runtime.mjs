import { mkdtemp, readFile, readdir, readlink, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const archive = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: node scripts/verify-postgres-runtime.mjs <artifact.tar.gz>');
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const temporaryRoot = await mkdtemp(join(tmpdir(), 'agenvyl-postgres-verify-'));
let dataRoot;
let postgresRunning = false;

try {
  run(tar, ['-xzf', archive, '-C', temporaryRoot]);
  const artifactName = basename(archive, '.tar.gz');
  const artifactRoot = join(temporaryRoot, artifactName);
  const postgresRoot = join(artifactRoot, 'postgres');
  const manifest = JSON.parse(await readFile(join(artifactRoot, 'manifest.json'), 'utf8'));
  assertManifest(manifest);
  await assertNoAbsoluteSymlinks(postgresRoot);

  const executable = name => join(postgresRoot, 'bin', process.platform === 'win32' ? `${name}.exe` : name);
  const env = runtimeEnvironment(postgresRoot);
  dataRoot = join(temporaryRoot, 'data with spaces ü');
  const dump = join(temporaryRoot, 'agenvyl-backup.dump');
  const log = join(temporaryRoot, 'postgres.log');
  const port = await freePort();
  const connection = ['-h', '127.0.0.1', '-p', String(port), '-U', 'agenvyl'];

  run(executable('initdb'), ['-D', dataRoot, '-U', 'agenvyl', '-A', 'trust', '--no-locale'], undefined, env);
  run(executable('pg_ctl'), ['-D', dataRoot, '-l', log, '-o', `-h 127.0.0.1 -p ${port}`, '-w', '-t', '60', 'start'], undefined, env);
  postgresRunning = true;
  run(executable('pg_isready'), [...connection, '-d', 'postgres'], undefined, env);
  run(executable('createdb'), [...connection, 'agenvyl_probe'], undefined, env);
  run(executable('psql'), [...connection, '-d', 'agenvyl_probe', '-v', 'ON_ERROR_STOP=1', '-c', "CREATE TABLE probe(value text NOT NULL); INSERT INTO probe VALUES ('portable-data-ok');"], undefined, env);
  run(executable('pg_dump'), [...connection, '-d', 'agenvyl_probe', '-Fc', '-Z0', '-f', dump], undefined, env);
  run(executable('dropdb'), [...connection, 'agenvyl_probe'], undefined, env);
  run(executable('createdb'), [...connection, 'agenvyl_probe'], undefined, env);
  run(executable('pg_restore'), [...connection, '-d', 'agenvyl_probe', '--exit-on-error', dump], undefined, env);
  const restored = capture(executable('psql'), [...connection, '-d', 'agenvyl_probe', '-At', '-c', 'SELECT value FROM probe'], env).trim();
  if (restored !== 'portable-data-ok') throw new Error(`Unexpected restored value: ${restored}`);

  run(executable('pg_ctl'), ['-D', dataRoot, '-m', 'fast', '-w', '-t', '60', 'stop'], undefined, env);
  postgresRunning = false;
  const status = spawnSync(executable('pg_ctl'), ['-D', dataRoot, 'status'], { env, stdio: 'ignore' });
  if (status.status === 0) throw new Error('PostgreSQL still reports a running server after stop');
  await assertPortReleased(port);
  console.log(`PostgreSQL runtime verified: ${manifest.postgresVersion} ${manifest.platform}-${manifest.architecture}`);
} finally {
  if (postgresRunning && dataRoot) {
    const artifactName = basename(archive, '.tar.gz');
    const postgresRoot = join(temporaryRoot, artifactName, 'postgres');
    const pgCtl = join(postgresRoot, 'bin', process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');
    spawnSync(pgCtl, ['-D', dataRoot, '-m', 'immediate', 'stop'], { env: runtimeEnvironment(postgresRoot), stdio: 'ignore' });
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}

function assertManifest(value) {
  if (!value || value.schemaVersion !== 1 || value.name !== 'agenvyl-postgres-runtime') throw new Error('Invalid PostgreSQL runtime manifest');
  const expectedPlatform = process.platform;
  if (value.platform !== expectedPlatform || value.architecture !== process.arch) throw new Error(`Artifact target ${value.platform}-${value.architecture} does not match host ${process.platform}-${process.arch}`);
  if (value.signing?.status !== 'unsigned' || value.signing?.requiredForPreview !== false) throw new Error('Preview signing boundary is missing');
}

function runtimeEnvironment(postgresRoot) {
  const bin = join(postgresRoot, 'bin'), lib = join(postgresRoot, 'lib');
  return {
    ...process.env,
    PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
    ...(process.platform === 'linux' ? { LD_LIBRARY_PATH: `${lib}:${process.env.LD_LIBRARY_PATH ?? ''}` } : {}),
    ...(process.platform === 'darwin' ? { DYLD_LIBRARY_PATH: `${lib}:${process.env.DYLD_LIBRARY_PATH ?? ''}` } : {}),
  };
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: false });
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
}
function capture(command, args, env) {
  const result = spawnSync(command, args, { env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
  return result.stdout;
}
async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}
async function assertPortReleased(port) {
  await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolvePromise));
  });
}
async function assertNoAbsoluteSymlinks(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      const target = await readlink(path);
      if (isAbsolute(target)) throw new Error(`Runtime payload contains an absolute symlink: ${path} -> ${target}`);
    } else if (entry.isDirectory()) {
      await assertNoAbsoluteSymlinks(path);
    }
  }
}
