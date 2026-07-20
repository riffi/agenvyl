import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  .toString('utf8')
  .split('\0')
  .filter(file => file && existsSync(file));

const findings = [];
const forbiddenReferences = [
  { label: 'private home path', pattern: new RegExp(['/home/', 'vladimir', '(?:/|\\b)'].join(''), 'i') },
  { label: 'private deployment name', pattern: new RegExp(['hermes', 'group', 'chat'].join('-'), 'i') },
  { label: 'internal ineses domain', pattern: new RegExp(['ineses', 'ru'].join('\\.'), 'i') },
  { label: 'internal Nodexium domain', pattern: new RegExp(['nodexium', 'temii', 'ru'].join('\\.'), 'i') },
];
const secretPatterns = [
  { label: 'private key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { label: 'GitHub token', pattern: /\b(?:gh[opsur]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
  { label: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { label: 'OpenAI-style secret', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
];

for (const file of files) {
  const buffer = readFileSync(file);
  if (buffer.includes(0)) continue;
  const text = buffer.toString('utf8');
  for (const check of [...forbiddenReferences, ...secretPatterns]) {
    if (check.pattern.test(text)) findings.push(`${file}: ${check.label}`);
  }
}

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const allowedLicenses = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'Unlicense',
]);
const localPackages = new Set([
  'node_modules/@agenvyl/connector',
  'node_modules/@agenvyl/connector-contract',
  'node_modules/@agenvyl/contracts',
  'node_modules/@agenvyl/runtime-config',
]);
const licenseCounts = new Map();

for (const [path, metadata] of Object.entries(lock.packages ?? {})) {
  if (!path.startsWith('node_modules/') || localPackages.has(path)) continue;
  const license = metadata.license;
  if (typeof license !== 'string' || !license) {
    findings.push(`${path}: missing dependency license metadata`);
    continue;
  }
  licenseCounts.set(license, (licenseCounts.get(license) ?? 0) + 1);
  if (!allowedLicenses.has(license)) {
    findings.push(`${path}: unreviewed dependency license ${license}`);
  }
}

if (lock.packages?.['']?.license !== 'Apache-2.0') {
  findings.push('package-lock.json: root package license must be Apache-2.0');
}

if (findings.length > 0) {
  console.error('OSS baseline audit failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  const summary = [...licenseCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([license, count]) => `${license}:${count}`)
    .join(', ');
  console.log(`OSS baseline audit passed (${files.length} tracked files).`);
  console.log(`Reviewed dependency licenses: ${summary}`);
}
