import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
export const POSTGRES_RUNTIME_CONFIG_PATH = resolve(repositoryRoot, 'packaging/postgres-runtime.json');
export const POSTGRES_RUNTIME_CONFIG = validate(JSON.parse(await readFile(POSTGRES_RUNTIME_CONFIG_PATH, 'utf8')));

export function runtimeTarget(platform = process.platform, architecture = process.arch) {
  const target = POSTGRES_RUNTIME_CONFIG.targets.find(candidate => candidate.platform === platform && candidate.architecture === architecture);
  if (!target) throw new Error(`Unsupported PostgreSQL runtime target: ${platform}-${architecture}`);
  return target;
}

export function targetName(target) {
  const platform = target.platform === 'win32' ? 'windows' : target.platform;
  return `${platform}-${target.architecture}`;
}

function validate(value) {
  if (!value || typeof value !== 'object' || !/^17\.\d+$/.test(value.version)) throw new Error('PostgreSQL runtime version must pin a 17.x release');
  if (!value.source || typeof value.source.url !== 'string' || !/^https:\/\/ftp\.postgresql\.org\//.test(value.source.url)) throw new Error('PostgreSQL runtime source must use the official HTTPS archive');
  if (typeof value.source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.source.sha256)) throw new Error('PostgreSQL runtime source SHA-256 is invalid');
  if (!Array.isArray(value.targets) || value.targets.length !== 5) throw new Error('PostgreSQL runtime target matrix must contain exactly five targets');
  const expectedTargets = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'];
  const actualTargets = value.targets.map(target => `${target.platform}-${target.architecture}`).sort();
  if (new Set(actualTargets).size !== expectedTargets.length || actualTargets.some((target, index) => target !== expectedTargets[index])) {
    throw new Error(`PostgreSQL runtime target matrix must be exactly: ${expectedTargets.join(', ')}`);
  }
  if (!Array.isArray(value.binaries) || value.binaries.length === 0) throw new Error('PostgreSQL runtime binary allowlist is empty');
  if (value.binaries.some(binary => typeof binary !== 'string' || !/^[a-z0-9_]+$/.test(binary)) || new Set(value.binaries).size !== value.binaries.length) {
    throw new Error('PostgreSQL runtime binary allowlist must contain unique binary names');
  }
  return value;
}
