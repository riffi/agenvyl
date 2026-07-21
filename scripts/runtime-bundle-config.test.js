import { describe, expect, it } from 'vitest';
import { RUNTIME_BUNDLE_TARGETS, runtimeBundleArchiveName, runtimeBundleTarget } from './runtime-bundle-config.mjs';

describe('runtime bundle configuration', () => {
  it('pins exactly the five Technical Preview targets', () => {
    expect(RUNTIME_BUNDLE_TARGETS.map(target => `${target.platform}-${target.architecture}`)).toEqual([
      'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64',
    ]);
  });

  it('uses the release archive format for each platform', () => {
    expect(runtimeBundleArchiveName('0.1.0', runtimeBundleTarget('linux', 'x64'))).toBe('agenvyl-0.1.0-linux-x64.tar.xz');
    expect(runtimeBundleArchiveName('0.1.0', runtimeBundleTarget('darwin', 'arm64'))).toBe('agenvyl-0.1.0-darwin-arm64.zip');
    expect(runtimeBundleArchiveName('0.1.0', runtimeBundleTarget('win32', 'x64'))).toBe('agenvyl-0.1.0-windows-x64.zip');
  });
});
