import type { WorkspaceEntry } from '@agenvyl/contracts';

export type WorkspaceTreeNode = {
  path: string;
  name: string;
  kind: 'file' | 'directory';
  entry?: WorkspaceEntry;
  children: WorkspaceTreeNode[];
};

export function buildWorkspaceTree(entries: WorkspaceEntry[]): WorkspaceTreeNode[] {
  const roots: WorkspaceTreeNode[] = [];
  const directories = new Map<string, WorkspaceTreeNode>();

  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path, 'ru', { numeric: true }))) {
    const parts = entry.path.split('/').filter(Boolean);
    let children = roots;
    let parentPath = '';

    parts.forEach((part, index) => {
      const path = parentPath ? `${parentPath}/${part}` : part;
      const isLeaf = index === parts.length - 1;
      let node = isLeaf && entry.kind === 'file' ? undefined : directories.get(path);

      if (!node) {
        node = {
          path,
          name: part,
          kind: isLeaf ? entry.kind : 'directory',
          entry: isLeaf ? entry : undefined,
          children: [],
        };
        children.push(node);
        if (node.kind === 'directory') directories.set(path, node);
      } else if (isLeaf) {
        node.entry = entry;
        node.name = entry.name;
      }

      children = node.children;
      parentPath = path;
    });
  }

  sortTree(roots);
  return roots;
}

export function filterWorkspaceTree(nodes: WorkspaceTreeNode[], query: string): WorkspaceTreeNode[] {
  const normalized = query.trim().toLocaleLowerCase('ru');
  if (!normalized) return nodes;

  return nodes.flatMap(node => {
    const children = filterWorkspaceTree(node.children, normalized);
    const matches = node.name.toLocaleLowerCase('ru').includes(normalized)
      || node.path.toLocaleLowerCase('ru').includes(normalized);
    return matches || children.length ? [{ ...node, children }] : [];
  });
}

export function treeDirectoryPaths(nodes: WorkspaceTreeNode[]): string[] {
  return nodes.flatMap(node => node.kind === 'directory' ? [node.path, ...treeDirectoryPaths(node.children)] : []);
}

function sortTree(nodes: WorkspaceTreeNode[]) {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, 'ru', { numeric: true });
  });
  nodes.forEach(node => sortTree(node.children));
}
