import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspacePolicy, WorkspacePolicyError } from './workspace-policy.js';

let root = '';
let outside = '';

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'agenvyl-workspaces-')));
  outside = await realpath(await mkdtemp(join(tmpdir(), 'agenvyl-outside-')));
  await mkdir(join(root, 'room-1', 'subdir'), { recursive: true });
  await writeFile(join(root, 'room-1', 'file.txt'), 'not a directory');
  await symlink(outside, join(root, 'room-1', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
});

afterEach(async () => {
  await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
});

describe('WorkspacePolicy', () => {
  it('maps a room and relative path to an existing canonical directory', () => {
    const policy = new WorkspacePolicy([root]);
    expect(policy.resolve('room-1', '.')).toBe(join(root, 'room-1'));
    expect(policy.resolve('room-1', 'subdir')).toBe(join(root, 'room-1', 'subdir'));
  });

  it.each([
    ['../outside', 'workspace_invalid'],
    ['/tmp', 'workspace_invalid'],
  ])('rejects unsafe relative path %s', (path, code) => {
    expectCode(() => new WorkspacePolicy([root]).resolve('room-1', path), code);
  });

  it('rejects invalid room IDs and symlink escapes without exposing host paths', () => {
    expectCode(() => new WorkspacePolicy([root]).resolve('../room-1', '.'), 'workspace_invalid');
    try {
      new WorkspacePolicy([root]).resolve('room-1', 'escape');
      throw new Error('Expected workspace policy to reject symlink escape');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspacePolicyError);
      expect((error as WorkspacePolicyError).code).toBe('workspace_forbidden');
      expect((error as Error).message).not.toContain(outside);
    }
  });

  it('rejects missing, non-directory and ambiguous workspace targets', async () => {
    const policy = new WorkspacePolicy([root]);
    expectCode(() => policy.resolve('missing-room', '.'), 'workspace_not_found');
    expectCode(() => policy.resolve('room-1', 'file.txt'), 'workspace_invalid');

    const secondRoot = await mkdtemp(join(tmpdir(), 'agenvyl-workspaces-second-'));
    await mkdir(join(secondRoot, 'room-1'));
    try {
      expectCode(() => new WorkspacePolicy([root, secondRoot]).resolve('room-1', '.'), 'workspace_ambiguous');
    } finally {
      await rm(secondRoot, { recursive: true, force: true });
    }
  });

  it('rejects duplicate roots after symlink canonicalization', async () => {
    const aliasParent = await mkdtemp(join(tmpdir(), 'agenvyl-workspaces-alias-'));
    const alias = join(aliasParent, 'root-link');
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      expect(() => new WorkspacePolicy([root, alias])).toThrow('duplicate canonical paths');
    } finally {
      await rm(aliasParent, { recursive: true, force: true });
    }
  });
});

function expectCode(action: () => unknown, code: string) {
  try {
    action();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspacePolicyError);
    expect((error as WorkspacePolicyError).code).toBe(code);
  }
}
