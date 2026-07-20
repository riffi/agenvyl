import { describe, expect, it } from 'vitest';
import type { WorkspaceEntry } from '@agenvyl/contracts';
import { buildWorkspaceTree, filterWorkspaceTree, treeDirectoryPaths } from './workspaceTree';

const entry = (path: string, kind: WorkspaceEntry['kind'] = 'file'): WorkspaceEntry => ({
  id: path,
  path,
  name: path.split('/').pop()!,
  kind,
  size: 12,
  mime_type: kind === 'file' ? 'text/plain' : '',
  updated_at: '2026-01-01T00:00:00.000Z',
});

describe('workspace tree', () => {
  it('creates missing parent folders and sorts folders before files', () => {
    const tree = buildWorkspaceTree([entry('z.txt'), entry('docs/b.txt'), entry('docs/a.txt'), entry('assets', 'directory')]);
    expect(tree.map(node => node.path)).toEqual(['assets', 'docs', 'z.txt']);
    expect(tree[1].children.map(node => node.path)).toEqual(['docs/a.txt', 'docs/b.txt']);
  });

  it('reuses explicit directory entries for generated parents', () => {
    const tree = buildWorkspaceTree([entry('docs/readme.md'), entry('docs', 'directory')]);
    expect(tree).toHaveLength(1);
    expect(tree[0].entry?.id).toBe('docs');
    expect(tree[0].children[0].path).toBe('docs/readme.md');
  });

  it('keeps ancestors of matching files and exposes their paths', () => {
    const filtered = filterWorkspaceTree(buildWorkspaceTree([entry('docs/notes/todo.md'), entry('assets/logo.svg')]), 'todo');
    expect(filtered[0].path).toBe('docs');
    expect(filtered[0].children[0].path).toBe('docs/notes');
    expect(treeDirectoryPaths(filtered)).toEqual(['docs', 'docs/notes']);
  });
});
