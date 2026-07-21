import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { RUNTIME_BUNDLE_TARGETS, runtimeBundleArchiveName, runtimeBundleTargetName } from './runtime-bundle-config.mjs';

export const RELEASE_MANIFEST_SCHEMA_VERSION = 1;

export async function createReleaseManifest({ version, channel = 'preview', baseUrl, archives, publishedAt = new Date().toISOString() }) {
  validateToken(version, 'version');
  validateToken(channel, 'channel');
  const archiveByName = new Map(archives.map(path => [basename(path), resolve(path)]));
  const targets = [];
  for (const target of RUNTIME_BUNDLE_TARGETS) {
    const filename = runtimeBundleArchiveName(version, target);
    const archive = archiveByName.get(filename);
    if (!archive) throw new Error(`Missing release archive for ${runtimeBundleTargetName(target)}: ${filename}`);
    const bytes = await readFile(archive);
    targets.push({
      target: runtimeBundleTargetName(target),
      platform: target.platform,
      architecture: target.architecture,
      archiveFormat: target.archiveFormat,
      filename,
      size: (await stat(archive)).size,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      url: new URL(filename, trailingSlash(baseUrl)).toString(),
    });
  }
  return { schemaVersion: RELEASE_MANIFEST_SCHEMA_VERSION, product: 'agenvyl', channel, version, publishedAt, targets };
}

export function releaseIndex(manifest) {
  const lines = [
    'agenvyl-release-index-v1',
    `version\t${manifest.version}`,
    `channel\t${manifest.channel}`,
    ...manifest.targets.map(target => ['target', target.target, target.filename, target.archiveFormat, target.size, target.sha256, target.url].join('\t')),
  ];
  return `${lines.join('\n')}\n`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  const packageJson = JSON.parse(await readFile(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'));
  const version = options.version ?? packageJson.version;
  const manifest = await createReleaseManifest({ version, channel: options.channel, baseUrl: options.baseUrl, archives: options.archives });
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  const indexOutput = resolve(options.indexOutput ?? output.replace(/\.json$/u, '.txt'));
  await writeFile(indexOutput, releaseIndex(manifest));
  console.log(JSON.stringify({ manifest: output, index: indexOutput, version, targets: manifest.targets.length }, null, 2));
}

function parseArgs(argv) {
  const result = { version: undefined, channel: 'preview', baseUrl: undefined, output: 'artifacts/release/agenvyl-release.json', indexOutput: undefined, archives: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--version') result.version = argv[++index];
    else if (argument === '--channel') result.channel = argv[++index];
    else if (argument === '--base-url') result.baseUrl = argv[++index];
    else if (argument === '--output') result.output = argv[++index];
    else if (argument === '--index-output') result.indexOutput = argv[++index];
    else result.archives.push(argument);
  }
  if (!result.baseUrl) throw new Error('--base-url is required');
  if (result.archives.length === 0) throw new Error('At least one portable archive is required');
  return result;
}

function validateToken(value, name) { if (!/^[0-9A-Za-z._-]+$/u.test(value)) throw new Error(`Invalid ${name}: ${value}`); }
function trailingSlash(value) { return value.endsWith('/') ? value : `${value}/`; }
