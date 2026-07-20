import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'apps', 'backend', 'src');
const allowedVendorConsumers = new Set(['app/container.ts']);
const files = [];

const walk = directory => {
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) files.push(path);
  }
};

walk(root);

const violations = [];
for (const file of files) {
  const source = relative(root, file).split(sep).join('/');
  if (source.startsWith('integrations/hermes/') || allowedVendorConsumers.has(source)) continue;
  for (const match of readFileSync(file, 'utf8').matchAll(/(?:from\s+|import\s*)['"]([^'"]*integrations\/hermes\/[^'"]+)['"]/g)) {
    violations.push(`${source} imports Hermes integration: ${match[1]}`);
  }
}

if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Backend vendor boundary OK (${files.length} modules checked)`);
}
