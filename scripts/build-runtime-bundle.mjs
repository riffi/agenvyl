import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const NODE_VERSION = '22.23.1';
const NODE_SHA256 = {
  arm64: '0294e8b915ab75f92c7513d2fcb830ae06e10684e6c603e99a87dbf8835389c1',
  x64: '9749e988f437343b7fa832c69ded82a312e41a03116d766797ac14f6f9eee578',
};
const repositoryRoot = resolve(import.meta.dirname, '..');
const args = parseArgs(process.argv.slice(2));
const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
const outputDirectory = resolve(repositoryRoot, args.outputDirectory);

if (!args.skipBuild) run('npm', ['run', 'build'], repositoryRoot);
await mkdir(outputDirectory, { recursive: true });
const temporaryRoot = await mkdtemp(join(tmpdir(), 'agenvyl-bundle-'));

try {
  for (const arch of args.arches) await buildBundle(arch);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function buildBundle(arch) {
  const bundleName = `agenvyl-${packageJson.version}-linux-${arch}`;
  const bundleRoot = join(temporaryRoot, bundleName);
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

  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], appRoot);
  run('npm', ['prune', '--omit=dev', '--ignore-scripts'], appRoot);

  await cp(join(repositoryRoot, 'packaging/bin'), join(bundleRoot, 'bin'), { recursive: true });
  await cp(join(repositoryRoot, 'packaging/libexec'), join(bundleRoot, 'libexec'), { recursive: true });
  await cp(join(repositoryRoot, 'packaging/systemd'), join(bundleRoot, 'systemd'), { recursive: true });
  await mkdir(join(bundleRoot, 'share/agenvyl'), { recursive: true });
  for (const file of ['compose.yaml', '.env.example', 'connector.example.yaml']) {
    await cp(join(repositoryRoot, file), join(bundleRoot, 'share/agenvyl', file));
  }
  for (const executable of ['agenvyl', 'agenvyl-core', 'agenvyl-connector', 'agenvyl-health']) await chmod(join(bundleRoot, 'bin', executable), 0o755);

  const nodeArchiveName = `node-v${NODE_VERSION}-linux-${arch}.tar.xz`;
  const nodeArchive = join(temporaryRoot, nodeArchiveName);
  if (!(await exists(nodeArchive))) run('curl', ['-fsSL', `https://nodejs.org/download/release/v${NODE_VERSION}/${nodeArchiveName}`, '-o', nodeArchive], repositoryRoot);
  const digest = createHash('sha256').update(await readFile(nodeArchive)).digest('hex');
  if (digest !== NODE_SHA256[arch]) throw new Error(`Node ${arch} checksum mismatch: ${digest}`);
  await mkdir(join(bundleRoot, 'runtime'), { recursive: true });
  run('tar', ['-xJf', nodeArchive, '--strip-components=1', '-C', join(bundleRoot, 'runtime')], repositoryRoot);
  for (const directory of ['include', 'lib', 'share']) await rm(join(bundleRoot, 'runtime', directory), { recursive: true, force: true });
  for (const executable of ['corepack', 'npm', 'npx']) await rm(join(bundleRoot, 'runtime/bin', executable), { force: true });

  await writeFile(join(bundleRoot, 'manifest.json'), `${JSON.stringify({
    name: 'agenvyl',
    version: packageJson.version,
    platform: 'linux',
    architecture: arch,
    nodeVersion: NODE_VERSION,
    nodeSha256: NODE_SHA256[arch],
  }, null, 2)}\n`);

  const archive = join(outputDirectory, `${bundleName}.tar.xz`);
  run('tar', ['-cJf', archive, '-C', temporaryRoot, basename(bundleRoot)], repositoryRoot);
  const archiveSha = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(`${archive}.sha256`, `${archiveSha}  ${basename(archive)}\n`);
  console.log(`${archive}\n${archiveSha}`);
}

function parseArgs(argv) {
  let arch = 'all', outputDirectory = 'artifacts', skipBuild = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--arch') arch = argv[++index];
    else if (argv[index] === '--output-dir') outputDirectory = argv[++index];
    else if (argv[index] === '--skip-build') skipBuild = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!['all', 'x64', 'arm64'].includes(arch)) throw new Error('--arch must be all, x64 or arm64');
  return { arches: arch === 'all' ? ['x64', 'arm64'] : [arch], outputDirectory, skipBuild };
}

function run(command, commandArgs, cwd) {
  const env = command === 'tar' ? { ...process.env, XZ_OPT: process.env.XZ_OPT ?? '-T2' } : process.env;
  const result = spawnSync(command, commandArgs, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
}

async function exists(path) {
  try { await readFile(path); return true; } catch { return false; }
}
