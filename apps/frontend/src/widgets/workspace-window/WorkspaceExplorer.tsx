import { useMemo, useRef, useState } from 'react';
import { ChevronRight, File, Folder, FolderOpen, FolderPlus, Search, Trash2, Upload } from 'lucide-react';
import type { WorkspaceEntry } from '@agenvyl/contracts';
import { IconButton } from '../../shared/ui';
import { buildWorkspaceTree, filterWorkspaceTree, treeDirectoryPaths, type WorkspaceTreeNode } from '../artifacts-drawer/workspaceTree';
import styles from './WorkspaceWindow.module.css';

export const WorkspaceExplorer = ({
  entries,
  selectedId,
  trash,
  loading,
  planModeEnabled,
  onFile,
  onDirectory,
  onUpload,
  onCreateFolder,
  onRename,
  onTrashToggle,
}: {
  entries: WorkspaceEntry[];
  selectedId?: string;
  trash: boolean;
  loading: boolean;
  planModeEnabled: boolean;
  onFile: (entry: WorkspaceEntry) => void;
  onDirectory: (path: string) => void;
  onUpload: (files: File[]) => void;
  onCreateFolder: () => void;
  onRename: (entry: WorkspaceEntry) => void;
  onTrashToggle: () => void;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildWorkspaceTree(entries), [entries]);
  const filtered = useMemo(() => filterWorkspaceTree(tree, search), [search, tree]);
  const effectiveExpanded = search ? new Set([...expanded, ...treeDirectoryPaths(filtered)]) : expanded;

  const toggleFolder = (path: string) => {
    onDirectory(path);
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  return <aside className={styles.explorer}>
    <div className={styles.explorerToolbar}>
      <label className={styles.search}><Search /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={trash ? 'Search trash' : 'Search files'} /></label>
      {!trash && <>
        <IconButton aria-label="Upload files" title="Upload" onClick={() => inputRef.current?.click()}><Upload /></IconButton>
        <IconButton aria-label="Create folder" title="Create folder" onClick={onCreateFolder}><FolderPlus /></IconButton>
      </>}
    </div>
    <input ref={inputRef} hidden type="file" multiple onChange={event => {
      if (event.target.files) onUpload([...event.target.files]);
      event.currentTarget.value = '';
    }} />
    <nav className={styles.tree} aria-label={trash ? 'Workspace trash' : 'Workspace files'} onDragOver={event => event.preventDefault()} onDrop={event => {
      if (trash || !event.dataTransfer.files.length) return;
      event.preventDefault();
      onUpload([...event.dataTransfer.files]);
    }}>
      {loading && <ExplorerMessage>Loading workspace…</ExplorerMessage>}
      {!loading && !filtered.length && <ExplorerMessage>{search ? 'No results' : trash ? 'Trash is empty' : 'Workspace is empty'}</ExplorerMessage>}
      {filtered.map(node => <TreeRow key={node.path} node={node} depth={0} expanded={effectiveExpanded} selectedId={selectedId} trash={trash} planModeEnabled={planModeEnabled} onFolder={toggleFolder} onFile={onFile} onRename={onRename} />)}
    </nav>
    <button className={`${styles.trashToggle} ${trash ? styles.trashActive : ''}`} onClick={() => { setSearch(''); onTrashToggle(); }}><Trash2 />{trash ? 'Back to files' : 'Trash'}</button>
  </aside>;
};

const TreeRow = ({
  node,
  depth,
  expanded,
  selectedId,
  trash,
  planModeEnabled,
  onFolder,
  onFile,
  onRename,
}: {
  node: WorkspaceTreeNode;
  depth: number;
  expanded: Set<string>;
  selectedId?: string;
  trash: boolean;
  planModeEnabled: boolean;
  onFolder: (path: string) => void;
  onFile: (entry: WorkspaceEntry) => void;
  onRename: (entry: WorkspaceEntry) => void;
}) => {
  const open = expanded.has(node.path);
  const entry = node.entry;
  return <div role="treeitem" aria-expanded={node.kind === 'directory' ? open : undefined}>
    <button
      className={`${styles.treeRow} ${entry?.id === selectedId ? styles.treeSelected : ''}`}
      style={{ paddingLeft: 9 + depth * 15 }}
      title={node.path}
      onClick={() => node.kind === 'directory' ? onFolder(node.path) : entry && onFile(entry)}
      onDoubleClick={() => !trash && (!planModeEnabled || entry?.path !== 'plan.md') && entry && onRename(entry)}
    >
      {node.kind === 'directory' ? <ChevronRight className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} /> : <span className={styles.chevronSpace} />}
      {node.kind === 'directory' ? open ? <FolderOpen /> : <Folder /> : <File />}
      <span>{node.name}</span>
      {entry?.status === 'oversize' && <em>oversize</em>}
    </button>
    {node.kind === 'directory' && open && node.children.map(child => <TreeRow key={child.path} node={child} depth={depth + 1} expanded={expanded} selectedId={selectedId} trash={trash} planModeEnabled={planModeEnabled} onFolder={onFolder} onFile={onFile} onRename={onRename} />)}
  </div>;
};

const ExplorerMessage = ({ children }: { children: string }) =>
  <div className={styles.explorerMessage}><File /><span>{children}</span></div>;
