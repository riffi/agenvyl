import { createHash } from 'node:crypto';
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { NODE_VERSION, runtimeBundleArchiveName, runtimeBundleTarget, runtimeBundleTargetName } from './runtime-bundle-config.mjs';
import { POSTGRES_RUNTIME_CONFIG } from './postgres-runtime-config.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const options = parseArgs(process.argv.slice(2));
const target = runtimeBundleTarget(options.platform, options.architecture);
if (target.platform !== process.platform || target.architecture !== process.arch) {
  throw new Error(`Portable bundle must be assembled natively: requested ${runtimeBundleTargetName(target)}, running ${process.platform}-${process.arch}`);
}

const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
const outputDirectory = resolve(repositoryRoot, options.outputDirectory);
const postgresArtifact = resolve(repositoryRoot, options.postgresArtifact ?? join(
  'artifacts', 'postgres-runtime',
  `agenvyl-postgres-${POSTGRES_RUNTIME_CONFIG.version}-${runtimeBundleTargetName(target)}.tar.gz`,
));
if (!(await exists(postgresArtifact))) throw new Error(`PostgreSQL runtime artifact is required: ${postgresArtifact}`);
if (!options.skipBuild) runNpm(['run', 'build'], repositoryRoot);

await mkdir(outputDirectory, { recursive: true });
const temporaryRoot = await mkdtemp(join(tmpdir(), 'agenvyl-portable-build-'));

try {
  const bundleName = `agenvyl-${packageJson.version}-${runtimeBundleTargetName(target)}`;
  const bundleRoot = join(temporaryRoot, bundleName);
  await assembleApplication(bundleRoot);
  const nodeSha256 = await installNode(bundleRoot, target);
  const postgresSha256 = await installPostgres(bundleRoot, target, postgresArtifact);
  await installLaunchers(bundleRoot, target.platform);
  await cp(join(repositoryRoot, 'LICENSE'), join(bundleRoot, 'LICENSE'));

  const manifest = {
    schemaVersion: 1,
    name: 'agenvyl-portable-runtime',
    version: packageJson.version,
    platform: target.platform,
    architecture: target.architecture,
    archiveFormat: target.archiveFormat,
    node: { version: NODE_VERSION, archive: target.nodeArchive, sha256: nodeSha256 },
    postgres: { version: POSTGRES_RUNTIME_CONFIG.version, artifact: basename(postgresArtifact), sha256: postgresSha256 },
    entrypoint: target.platform === 'win32' ? 'Start Agenvyl.cmd' : `Start Agenvyl.${target.platform === 'darwin' ? 'command' : 'sh'}`,
    signing: { requiredForPreview: false, status: 'unsigned' },
  };
  await writeFile(join(bundleRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const archive = join(outputDirectory, runtimeBundleArchiveName(packageJson.version, target));
  createArchive(archive, temporaryRoot, bundleRoot, target);
  const archiveSha256 = digest(await readFile(archive));
  await writeFile(`${archive}.sha256`, `${archiveSha256}  ${basename(archive)}\n`);
  console.log(JSON.stringify({ archive, sha256: archiveSha256, manifest }, null, 2));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true, maxRetries: process.platform === 'win32' ? 10 : 0, retryDelay: 250 });
}

async function assembleApplication(bundleRoot) {
  const appRoot = join(bundleRoot, 'app');
  await mkdir(appRoot, { recursive: true });
  for (const file of ['package.json', 'package-lock.json']) await cp(join(repositoryRoot, file), join(appRoot, file));
  for (const directory of ['apps/connector', 'packages/contracts', 'packages/connector-contract', 'packages/runtime-config', 'packages/supervisor']) {
    await mkdir(join(appRoot, directory), { recursive: true });
    await cp(join(repositoryRoot, directory, 'package.json'), join(appRoot, directory, 'package.json'));
  }
  for (const directory of ['apps/backend/dist', 'apps/frontend/dist', 'apps/connector/dist', 'packages/contracts/dist', 'packages/connector-contract/dist', 'packages/runtime-config/dist', 'packages/supervisor/dist']) {
    await cp(join(repositoryRoot, directory), join(appRoot, directory), {
      recursive: true,
      filter: source => !source.endsWith('.d.ts') && !source.endsWith('.d.ts.map') && !basename(source).includes('.test.'),
    });
  }
  runNpm(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], appRoot);
  runNpm(['prune', '--omit=dev', '--ignore-scripts'], appRoot);
}

async function installNode(bundleRoot, target) {
  const archive = join(temporaryRoot, target.nodeArchive);
  await download(`https://nodejs.org/download/release/v${NODE_VERSION}/${target.nodeArchive}`, archive);
  const actual = digest(await readFile(archive));
  if (actual !== target.nodeSha256) throw new Error(`Node checksum mismatch for ${runtimeBundleTargetName(target)}: ${actual}`);
  const extractionRoot = join(temporaryRoot, 'node-extracted');
  await mkdir(extractionRoot);
  const tar = tarCommand();
  const mode = target.nodeArchive.endsWith('.tar.xz') ? '-xJf' : target.nodeArchive.endsWith('.tar.gz') ? '-xzf' : '-xf';
  run(tar, [mode, archive, '-C', extractionRoot]);
  const entries = await readdir(extractionRoot);
  if (entries.length !== 1) throw new Error(`Unexpected Node archive layout: ${entries.join(', ')}`);
  const runtimeRoot = join(bundleRoot, 'runtime');
  await cp(join(extractionRoot, entries[0]), runtimeRoot, { recursive: true, dereference: true });
  if (target.platform === 'win32') {
    for (const item of ['node_modules', 'npm', 'npm.cmd', 'npx', 'npx.cmd', 'corepack', 'corepack.cmd']) await rm(join(runtimeRoot, item), { recursive: true, force: true });
  } else {
    for (const directory of ['include', 'lib', 'share']) await rm(join(runtimeRoot, directory), { recursive: true, force: true });
    for (const executable of ['corepack', 'npm', 'npx']) await rm(join(runtimeRoot, 'bin', executable), { force: true });
    await chmod(join(runtimeRoot, 'bin', 'node'), 0o755);
  }
  return actual;
}

async function installPostgres(bundleRoot, target, archive) {
  const sidecar = `${archive}.sha256`;
  if (!(await exists(sidecar))) throw new Error(`PostgreSQL checksum sidecar is required: ${sidecar}`);
  const expected = (await readFile(sidecar, 'utf8')).trim().split(/\s+/, 1)[0];
  const actual = digest(await readFile(archive));
  if (actual !== expected) throw new Error(`PostgreSQL artifact checksum mismatch: ${actual}`);
  const extractionRoot = join(temporaryRoot, 'postgres-extracted');
  await mkdir(extractionRoot);
  run(tarCommand(), ['-xzf', archive, '-C', extractionRoot]);
  const entries = await readdir(extractionRoot);
  if (entries.length !== 1) throw new Error(`Unexpected PostgreSQL artifact layout: ${entries.join(', ')}`);
  const artifactRoot = join(extractionRoot, entries[0]);
  const manifest = JSON.parse(await readFile(join(artifactRoot, 'manifest.json'), 'utf8'));
  if (manifest.platform !== target.platform || manifest.architecture !== target.architecture) {
    throw new Error(`PostgreSQL artifact target mismatch: ${manifest.platform}-${manifest.architecture}`);
  }
  const postgresRoot = join(bundleRoot, 'postgres');
  await cp(join(artifactRoot, 'postgres'), postgresRoot, { recursive: true });
  await makeSymlinksRelocatable(postgresRoot);
  const metadataRoot = join(bundleRoot, 'share', 'agenvyl');
  await mkdir(metadataRoot, { recursive: true });
  await cp(join(artifactRoot, 'manifest.json'), join(metadataRoot, 'postgres-manifest.json'));
  await cp(join(artifactRoot, 'sbom.cdx.json'), join(metadataRoot, 'postgres-sbom.cdx.json'));
  await cp(join(artifactRoot, 'POSTGRESQL-COPYRIGHT'), join(metadataRoot, 'POSTGRESQL-COPYRIGHT'));
  return actual;
}

async function makeSymlinksRelocatable(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await makeSymlinksRelocatable(path);
    else if (entry.isSymbolicLink()) {
      const target = await readlink(path);
      if (!isAbsolute(target)) continue;
      const relativeTarget = basename(target);
      const sibling = join(dirname(path), relativeTarget);
      if (!(await exists(sibling)) || !(await lstat(sibling)).isFile()) throw new Error(`Absolute PostgreSQL symlink cannot be relocated: ${path} -> ${target}`);
      await rm(path);
      await symlink(relativeTarget, path);
    }
  }
}

async function installLaunchers(bundleRoot, platform) {
  await mkdir(join(bundleRoot, 'bin'), { recursive: true });
  if (platform === 'win32') {
    await cp(join(repositoryRoot, 'packaging/bin/agenvyl.cmd'), join(bundleRoot, 'bin/agenvyl.cmd'));
    await cp(join(repositoryRoot, 'packaging/launchers/windows'), bundleRoot, { recursive: true });
    return;
  }
  await cp(join(repositoryRoot, 'packaging/bin/agenvyl'), join(bundleRoot, 'bin/agenvyl'));
  await chmod(join(bundleRoot, 'bin/agenvyl'), 0o755);
  const extension = platform === 'darwin' ? 'command' : 'sh';
  for (const action of ['Start', 'Stop', 'Status']) {
    const destination = join(bundleRoot, `${action} Agenvyl.${extension}`);
    await cp(join(repositoryRoot, `packaging/launchers/unix/${action.toLowerCase()}.sh`), destination);
    await chmod(destination, 0o755);
  }
}

function createArchive(archive, parent, bundleRoot, target) {
  if (target.archiveFormat === 'tar.xz') {
    run(tarCommand(), ['-cJf', archive, '-C', parent, basename(bundleRoot)], { XZ_OPT: process.env.XZ_OPT ?? '-T2' });
  } else if (target.platform === 'darwin') {
    run('ditto', ['-c', '-k', '--keepParent', bundleRoot, archive]);
  } else {
    run(tarCommand(), ['-a', '-cf', archive, '-C', parent, basename(bundleRoot)]);
  }
}

function parseArgs(argv) {
  const result = { platform: process.platform, architecture: process.arch, outputDirectory: 'artifacts/portable', postgresArtifact: undefined, skipBuild: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--platform') result.platform = argv[++index];
    else if (argument === '--arch') result.architecture = argv[++index];
    else if (argument === '--output-dir') result.outputDirectory = argv[++index];
    else if (argument === '--postgres-artifact') result.postgresArtifact = argv[++index];
    else if (argument === '--skip-build') result.skipBuild = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  runtimeBundleTarget(result.platform, result.architecture);
  return result;
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}
function runNpm(args, cwd) {
  const command = process.platform === 'win32' ? join(dirname(process.execPath), 'npm.cmd') : 'npm';
  run(command, args, cwd);
}
function run(command, args, cwdOrEnv = repositoryRoot, extraEnv = undefined) {
  const cwd = typeof cwdOrEnv === 'string' ? cwdOrEnv : repositoryRoot;
  const env = typeof cwdOrEnv === 'string' ? (extraEnv ? { ...process.env, ...extraEnv } : process.env) : { ...process.env, ...cwdOrEnv };
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', windowsHide: true, shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd') });
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
}
function tarCommand() { return process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'; }
function digest(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
async function exists(path) { try { await stat(path); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } }
