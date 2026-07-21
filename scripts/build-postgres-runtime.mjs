import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { POSTGRES_RUNTIME_CONFIG, runtimeTarget, targetName } from './postgres-runtime-config.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const options = parseArgs(process.argv.slice(2));
const target = runtimeTarget(options.platform, options.architecture);
if (target.platform !== process.platform || target.architecture !== process.arch) {
  throw new Error(`PostgreSQL runtime must be built natively: requested ${targetName(target)}, running ${process.platform}-${process.arch}`);
}

const outputDirectory = resolve(repositoryRoot, options.outputDirectory);
await mkdir(outputDirectory, { recursive: true });
const temporaryRoot = await mkdtemp(join(tmpdir(), 'agenvyl-postgres-build-'));

try {
  const sourceArchive = options.sourceArchive ? resolve(options.sourceArchive) : join(temporaryRoot, basename(POSTGRES_RUNTIME_CONFIG.source.url));
  if (!options.sourceArchive) await download(POSTGRES_RUNTIME_CONFIG.source.url, sourceArchive);
  await verifySha256(sourceArchive, POSTGRES_RUNTIME_CONFIG.source.sha256);
  run('tar', ['-xjf', sourceArchive, '-C', temporaryRoot]);

  const sourceRoot = join(temporaryRoot, `postgresql-${POSTGRES_RUNTIME_CONFIG.version}`);
  const installRoot = join(temporaryRoot, 'install');
  if (target.platform === 'win32') buildWithMeson(sourceRoot, installRoot, options.jobs);
  else buildWithConfigure(sourceRoot, installRoot, options.jobs);

  const artifactName = `agenvyl-postgres-${POSTGRES_RUNTIME_CONFIG.version}-${targetName(target)}`;
  const artifactRoot = join(temporaryRoot, artifactName);
  const postgresRoot = join(artifactRoot, 'postgres');
  await mkdir(postgresRoot, { recursive: true });
  for (const directory of ['lib', 'share']) await copyIfPresent(join(installRoot, directory), join(postgresRoot, directory));
  await mkdir(join(postgresRoot, 'bin'), { recursive: true });
  for (const binary of POSTGRES_RUNTIME_CONFIG.binaries) {
    const filename = target.platform === 'win32' ? `${binary}.exe` : binary;
    const source = join(installRoot, 'bin', filename);
    await cp(source, join(postgresRoot, 'bin', filename));
    if (target.platform !== 'win32') await chmod(join(postgresRoot, 'bin', filename), 0o755);
  }
  if (target.platform === 'win32') {
    for (const file of await readdir(join(installRoot, 'bin'))) {
      if (file.toLowerCase().endsWith('.dll')) await cp(join(installRoot, 'bin', file), join(postgresRoot, 'bin', file));
    }
  }
  await cp(join(sourceRoot, 'COPYRIGHT'), join(artifactRoot, 'POSTGRESQL-COPYRIGHT'));

  const manifest = {
    schemaVersion: 1,
    name: 'agenvyl-postgres-runtime',
    postgresVersion: POSTGRES_RUNTIME_CONFIG.version,
    platform: target.platform,
    architecture: target.architecture,
    source: POSTGRES_RUNTIME_CONFIG.source,
    build: {
      native: true,
      system: target.platform === 'win32' ? 'meson' : 'autoconf-make',
      features: ['core-server', 'client-tools', 'no-optional-extensions'],
    },
    binaries: POSTGRES_RUNTIME_CONFIG.binaries,
    signing: { requiredForPreview: false, status: 'unsigned' },
  };
  await writeFile(join(artifactRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(artifactRoot, 'sbom.cdx.json'), `${JSON.stringify(cycloneDx(manifest), null, 2)}\n`);

  const archive = join(outputDirectory, `${artifactName}.tar.gz`);
  run('tar', ['-czf', archive, '-C', temporaryRoot, artifactName]);
  const archiveSha256 = digest(await readFile(archive));
  await writeFile(`${archive}.sha256`, `${archiveSha256}  ${basename(archive)}\n`);
  console.log(JSON.stringify({ archive, sha256: archiveSha256, manifest }, null, 2));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function buildWithConfigure(sourceRoot, installRoot, jobs) {
  run(join(sourceRoot, 'configure'), [
    `--prefix=${installRoot}`,
    '--disable-rpath',
    '--disable-nls',
    '--without-icu',
    '--without-readline',
    '--without-zlib',
  ], sourceRoot);
  run('make', [`-j${jobs}`], sourceRoot);
  run('make', ['install-strip'], sourceRoot);
}

function buildWithMeson(sourceRoot, installRoot, jobs) {
  const buildRoot = join(sourceRoot, 'build-agenvyl');
  run('meson', [
    'setup', buildRoot, sourceRoot,
    `--prefix=${installRoot}`,
    '--buildtype=release',
    '-Dauto_features=disabled',
    '-Drpath=false',
    '-Dssl=none',
  ]);
  run('meson', ['compile', '-C', buildRoot, '-j', String(jobs)]);
  run('meson', ['install', '-C', buildRoot]);
}

function parseArgs(argv) {
  const options = { platform: process.platform, architecture: process.arch, outputDirectory: 'artifacts/postgres-runtime', jobs: 2, sourceArchive: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--platform') options.platform = argv[++index];
    else if (argument === '--arch') options.architecture = argv[++index];
    else if (argument === '--output-dir') options.outputDirectory = argv[++index];
    else if (argument === '--jobs') options.jobs = Number(argv[++index]);
    else if (argument === '--source-archive') options.sourceArchive = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isSafeInteger(options.jobs) || options.jobs < 1) throw new Error('--jobs must be a positive integer');
  return options;
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to download PostgreSQL source: HTTP ${response.status}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function verifySha256(path, expected) {
  const actual = digest(await readFile(path));
  if (actual !== expected) throw new Error(`PostgreSQL source checksum mismatch: ${actual}`);
}

async function copyIfPresent(source, destination) {
  try { await cp(source, destination, { recursive: true, dereference: true }); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function digest(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function run(command, args, cwd = repositoryRoot) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
}
function cycloneDx(manifest) {
  return {
    bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
    metadata: { component: { type: 'application', name: manifest.name, version: manifest.postgresVersion } },
    components: [{
      type: 'application', name: 'PostgreSQL', version: manifest.postgresVersion,
      licenses: [{ license: { name: 'PostgreSQL License' } }],
      externalReferences: [{ type: 'distribution', url: manifest.source.url }],
      hashes: [{ alg: 'SHA-256', content: manifest.source.sha256 }],
    }],
  };
}
