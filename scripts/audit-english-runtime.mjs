import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const sourceRoots = [
  path.join(repositoryRoot, 'apps', 'frontend', 'src'),
  path.join(repositoryRoot, 'apps', 'backend', 'src'),
];
const cyrillicPattern = /[\u0400-\u04ff]/u;

// These entries support Cyrillic input or data created by older versions. They
// are not presented as current English UI copy.
const allowedRuntimeCyrillic = new Map([
  ['apps/frontend/src/widgets/personas-screen/personaDraft.ts', () => true],
  [
    'apps/backend/src/modules/messages/messages.repository.ts',
    (line) => line.includes('Зафиксированные inline-изображения ответа'),
  ],
  [
    'apps/backend/src/modules/runs/RunExecutor.ts',
    (line) => line.includes('const labels = text.matchAll'),
  ],
]);

function usesRuntimeSource(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  return (
    /\.(?:js|mjs|ts|tsx)$/u.test(normalized) &&
    !/\.(?:test|spec)\.[^.]+$/u.test(normalized) &&
    !normalized.includes('/test/')
  );
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
    }),
  );
  return nested.flat();
}

const violations = [];
for (const sourceRoot of sourceRoots) {
  for (const filePath of (await collectFiles(sourceRoot)).filter(usesRuntimeSource)) {
    const relativePath = path.relative(repositoryRoot, filePath).replaceAll('\\', '/');
    const allowLine = allowedRuntimeCyrillic.get(relativePath);
    const lines = (await readFile(filePath, 'utf8')).split(/\r?\n/u);

    lines.forEach((line, index) => {
      if (cyrillicPattern.test(line) && !allowLine?.(line)) {
        violations.push(`${relativePath}:${index + 1}: ${line.trim()}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error('Unexpected Cyrillic text found in the English runtime:');
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exitCode = 1;
} else {
  console.log('English runtime audit passed.');
}
