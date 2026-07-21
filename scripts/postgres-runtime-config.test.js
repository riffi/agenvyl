import { describe, expect, it } from 'vitest';
import { POSTGRES_RUNTIME_CONFIG, runtimeTarget, targetName } from './postgres-runtime-config.mjs';

describe('PostgreSQL runtime configuration', () => {
  it('pins the supported native target matrix', () => {
    expect(POSTGRES_RUNTIME_CONFIG.targets.map(targetName).sort()).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-arm64',
      'linux-x64',
      'windows-x64',
    ]);
  });

  it('rejects targets outside the portable preview contract', () => {
    expect(() => runtimeTarget('win32', 'arm64')).toThrow('Unsupported PostgreSQL runtime target');
  });
});
