import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'apps', 'frontend', 'src');
const rank = new Map([['shared',0],['entities',1],['features',2],['widgets',3],['pages',4],['app',5]]);
const files = [];
const walk = directory => {
  for (const name of readdirSync(directory)) {
    const path = resolve(directory,name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) files.push(path);
  }
};
walk(root);

const violations = [];
for (const file of files) {
  const source = relative(root,file).split(sep);
  const sourceLayer = source[0];
  for (const match of readFileSync(file,'utf8').matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)) {
    const target = relative(root,resolve(dirname(file),match[1])).split(sep);
    const targetLayer = target[0];
    if (!rank.has(sourceLayer) || !rank.has(targetLayer)) continue;
    if (rank.get(targetLayer) > rank.get(sourceLayer)) violations.push(`${relative(root,file)} imports upper layer ${targetLayer}: ${match[1]}`);
  }
}

if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Frontend boundaries OK (${files.length} modules checked)`);
}
